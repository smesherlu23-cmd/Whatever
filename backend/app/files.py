"""Картинки и вложения досок на диске.

Описание файла (имя, тип, размер) хранится в таблице board_files, а содержимое — здесь,
в <каталог>/<id доски>/<id файла>. Файл пишется во временный и получает своё имя, только
когда принят целиком и записан на диск: оборванная загрузка не оставит на доске половину
картинки, а сбой питания — файл, о котором знает база, но которого нет на диске.

Работа с диском идёт в потоках, чтобы не останавливать цикл событий.
"""

import asyncio
import os
import shutil
import uuid
from collections.abc import AsyncIterable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

OCTET_STREAM = "application/octet-stream"

# Сигнатуры картинок, которые браузер показывает прямо на доске. Тип определяется
# по содержимому, а не по заголовку запроса: иначе под видом картинки можно было бы
# загрузить страницу со скриптом. Всё остальное отдаётся только на скачивание.
IMAGE_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)
IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
# Столько первых байтов нужно, чтобы узнать любую из картинок, включая WebP.
SNIFF_BYTES = 12
# Принятые данные копятся в памяти и пишутся на диск порциями такого размера.
WRITE_BATCH = 1 << 20


class FileTooLargeError(Exception):
    """Файл больше допустимого размера. Ничего из него не сохранено."""


def sniff(head: bytes) -> str:
    """Тип содержимого по первым байтам файла: одна из картинок или application/octet-stream."""
    for signature, content_type in IMAGE_SIGNATURES:
        if head.startswith(signature):
            return content_type
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return OCTET_STREAM


@dataclass(frozen=True)
class SavedFile:
    size: int
    content_type: str


class _PartialFile:
    """Файл, который ещё загружается. Методы блокирующие: их вызывают в потоке."""

    def __init__(self, target: Path) -> None:
        self.target = target
        self.partial = target.with_name(f".{target.name}.part")
        target.parent.mkdir(parents=True, exist_ok=True)
        self.handle: BinaryIO = self.partial.open("wb")

    def write(self, data: bytes | bytearray) -> None:
        self.handle.write(data)

    def commit(self) -> None:
        """Записывает файл на диск и даёт ему постоянное имя."""
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.handle.close()
        self.partial.replace(self.target)
        # Переименование тоже должно дойти до диска: оно записано в каталоге.
        directory = os.open(self.target.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def discard(self) -> None:
        self.handle.close()
        self.partial.unlink(missing_ok=True)


def _remove_tree(path: Path) -> None:
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        return


class FileStore:
    """Файлы досок в каталоге root. Файл больше max_size байт не принимается."""

    def __init__(self, root: Path, max_size: int) -> None:
        self.root = root
        self.max_size = max_size

    def path(self, board_id: uuid.UUID, file_id: uuid.UUID) -> Path:
        return self.root / str(board_id) / str(file_id)

    async def save(
        self, board_id: uuid.UUID, file_id: uuid.UUID, chunks: AsyncIterable[bytes]
    ) -> SavedFile:
        """Сохраняет файл из потока chunks. Если поток оборвался или файл слишком большой,
        временный файл удаляется и исключение идёт дальше."""
        upload = await asyncio.to_thread(_PartialFile, self.path(board_id, file_id))
        size = 0
        head = b""
        batch = bytearray()
        try:
            async for chunk in chunks:
                size += len(chunk)
                if size > self.max_size:
                    raise FileTooLargeError
                if len(head) < SNIFF_BYTES:
                    head = (head + chunk)[:SNIFF_BYTES]
                batch += chunk
                if len(batch) >= WRITE_BATCH:
                    await asyncio.to_thread(upload.write, batch)
                    batch.clear()
            await asyncio.to_thread(upload.write, batch)
            await asyncio.to_thread(upload.commit)
        except BaseException:
            # Без потока и ожидания: при отмене задачи любое await прервётся снова,
            # а временный файл должен исчезнуть. Закрытие и удаление занимают микросекунды.
            upload.discard()
            raise
        return SavedFile(size, sniff(head))

    async def stat(self, board_id: uuid.UUID, file_id: uuid.UUID) -> os.stat_result | None:
        """Сведения о файле с диска или None, если файла там нет."""
        try:
            return await asyncio.to_thread(self.path(board_id, file_id).stat)
        except FileNotFoundError:
            return None

    async def delete(self, board_id: uuid.UUID, file_id: uuid.UUID) -> None:
        await asyncio.to_thread(self.path(board_id, file_id).unlink, missing_ok=True)

    async def delete_board(self, board_id: uuid.UUID) -> None:
        """Удаляет все файлы доски."""
        await asyncio.to_thread(_remove_tree, self.root / str(board_id))
