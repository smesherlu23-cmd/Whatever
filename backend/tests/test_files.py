"""Картинки и вложения: загрузка, скачивание, права и удаление вместе с доской."""

import errno
import logging
import os
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Message

from app.api.files import file_name
from app.auth.sessions import COOKIE_NAME
from app.core.config import get_settings
from app.core.db import Database
from app.files import WRITE_BATCH, FileStore, FileTooLargeError, sniff
from app.main import create_app
from app.models import Board, BoardFile
from tests.conftest import act_as, in_app_db, sign_in
from tests.test_access import new_board, share

PNG = b"\x89PNG\r\n\x1a\n" + bytes(40)
PDF = b"%PDF-1.7\n" + bytes(40)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def files_url(board_id: str, file_id: str = "") -> str:
    return f"/api/boards/{board_id}/files" + (f"/{file_id}" if file_id else "")


def upload(
    client: TestClient, board_id: str, content: bytes, name: str = "схема.png", **headers: str
) -> httpx.Response:
    response: httpx.Response = client.post(
        files_url(board_id), content=content, headers={"X-File-Name": quote(name), **headers}
    )
    return response


def uploaded(client: TestClient, board_id: str, content: bytes, name: str = "схема.png") -> str:
    response = upload(client, board_id, content, name)
    assert response.status_code == 201, response.text
    file_id: str = response.json()["id"]
    return file_id


def store(client: TestClient) -> FileStore:
    app = client.app
    assert isinstance(app, FastAPI)
    files: FileStore = app.state.files
    return files


def stored_names(client: TestClient, board_id: str) -> list[str]:
    """Что лежит на диске в каталоге доски, включая временные файлы."""
    directory = store(client).root / board_id
    return sorted(path.name for path in directory.iterdir()) if directory.exists() else []


def file_rows(client: TestClient, board_id: str) -> int:
    async def count(db: AsyncSession) -> int:
        query = select(func.count()).where(BoardFile.board_id == uuid.UUID(board_id))
        return await db.scalar(query) or 0

    return in_app_db(client, count)


def test_an_image_is_shown_inline(anon_client: TestClient) -> None:
    client = anon_client
    author = sign_in(client)
    board = new_board(client)
    # Заявленный клиентом тип не важен: тип определяется по содержимому.
    response = upload(client, board["id"], PNG, "Схема сервисов.png", **{"Content-Type": "x/y"})
    assert response.status_code == 201
    info = response.json()
    assert info["name"] == "Схема сервисов.png"
    assert info["content_type"] == "image/png"
    assert info["size"] == len(PNG)

    download = client.get(files_url(board["id"], info["id"]))
    assert download.status_code == 200
    assert download.content == PNG
    assert download.headers["content-type"] == "image/png"
    disposition = download.headers["content-disposition"]
    assert disposition.startswith("inline;")
    assert f"filename*=utf-8''{quote('Схема сервисов.png')}" in disposition
    assert "immutable" in download.headers["cache-control"]
    assert download.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in download.headers["content-security-policy"]

    async def uploader(db: AsyncSession) -> uuid.UUID | None:
        record = await db.get(BoardFile, (uuid.UUID(board["id"]), uuid.UUID(info["id"])))
        assert record is not None
        return record.uploaded_by_id

    assert str(in_app_db(client, uploader)) == author.id


@pytest.mark.parametrize(
    ("content", "name", "claimed"),
    [(PDF, "отчёт.pdf", "application/pdf"), (SVG, "logo.svg", "image/svg+xml")],
)
def test_other_files_are_only_downloaded(
    client: TestClient, content: bytes, name: str, claimed: str
) -> None:
    board = new_board(client)
    response = upload(client, board["id"], content, name, **{"Content-Type": claimed})
    assert response.json()["content_type"] == "application/octet-stream"

    download = client.get(files_url(board["id"], response.json()["id"]))
    assert download.content == content
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment;")


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        (PNG, "image/png"),
        (b"\xff\xd8\xff\xe0" + bytes(8), "image/jpeg"),
        (b"GIF87a" + bytes(6), "image/gif"),
        (b"GIF89a" + bytes(6), "image/gif"),
        (b"RIFF\x24\x00\x00\x00WEBP", "image/webp"),
        (b"RIFF\x24\x00\x00\x00WAVE", "application/octet-stream"),
        (SVG[:12], "application/octet-stream"),
        (b"", "application/octet-stream"),
    ],
)
def test_type_is_detected_by_content(head: bytes, expected: str) -> None:
    assert sniff(head) == expected


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (quote("план.pdf"), "план.pdf"),
        (quote("../../etc/passwd"), "passwd"),
        (quote("C:\\docs\\отчёт.docx"), "отчёт.docx"),
        (quote("a\nb\x00c.txt"), "abc.txt"),
        (quote("  итог.txt  "), "итог.txt"),
        ("", "файл"),
        (quote("../"), "файл"),
        ("x" * 300, "x" * 255),
    ],
)
def test_file_names_are_cleaned(header: str, expected: str) -> None:
    assert file_name(header) == expected


def test_too_large_files_are_rejected() -> None:
    settings = get_settings().model_copy(update={"max_upload_mb": 1})
    limit = settings.max_upload_bytes
    with TestClient(create_app(settings)) as client:
        sign_in(client)
        board = new_board(client)
        declared = upload(client, board["id"], bytes(limit + 1))
        assert declared.status_code == 413
        assert declared.json()["detail"] == "Файл больше 1 МБ"

        # Без Content-Length размер считается по ходу приёма.
        def chunks() -> Iterator[bytes]:
            yield bytes(limit)
            yield b"!"

        streamed = client.post(files_url(board["id"]), content=chunks())
        assert streamed.status_code == 413
        assert stored_names(client, board["id"]) == []
        assert file_rows(client, board["id"]) == 0

        assert upload(client, board["id"], bytes(limit)).status_code == 201


def test_only_editors_upload_and_members_download(anon_client: TestClient) -> None:
    client = anon_client
    viewer, outsider = sign_in(client), sign_in(client)
    sign_in(client)
    board = new_board(client)
    share(client, board, viewer, "viewer")
    file_id = uploaded(client, board["id"], PNG)
    other_board = new_board(client, "Другая")

    act_as(client, viewer)
    assert upload(client, board["id"], PNG).status_code == 403
    assert client.get(files_url(board["id"], file_id)).status_code == 200
    # Файл ищется только среди файлов доски из адреса.
    assert client.get(files_url(other_board["id"], file_id)).status_code == 403

    act_as(client, outsider)
    assert client.get(files_url(board["id"], file_id)).status_code == 403


def test_unknown_files_are_not_found(client: TestClient) -> None:
    board, other = new_board(client), new_board(client, "Другая")
    file_id = uploaded(client, board["id"], PNG)
    assert client.get(files_url(board["id"], str(uuid.uuid4()))).status_code == 404
    assert client.get(files_url(other["id"], file_id)).status_code == 404


def test_deleting_a_board_deletes_its_files(client: TestClient) -> None:
    board = new_board(client)
    file_id = uploaded(client, board["id"], PNG)
    assert stored_names(client, board["id"]) == [file_id]

    assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert not (store(client).root / board["id"]).exists()
    assert file_rows(client, board["id"]) == 0


def test_board_deletion_does_not_fail_on_leftover_files(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    board = new_board(client)
    uploaded(client, board["id"], PNG)

    async def broken(self: FileStore, board_id: uuid.UUID) -> None:
        raise PermissionError(board_id)

    monkeypatch.setattr(FileStore, "delete_board", broken)
    with caplog.at_level(logging.ERROR, logger="app.api.boards"):
        assert client.delete(f"/api/boards/{board['id']}").status_code == 204
    assert "Не удалось удалить файлы доски" in caplog.text
    assert client.get(f"/api/boards/{board['id']}").status_code == 404


def test_a_file_lost_on_disk_is_reported(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    board = new_board(client)
    file_id = uploaded(client, board["id"], PNG)
    store(client).path(uuid.UUID(board["id"]), uuid.UUID(file_id)).unlink()

    with caplog.at_level(logging.WARNING, logger="app.api.files"):
        assert client.get(files_url(board["id"], file_id)).status_code == 404
    assert "не найден на диске" in caplog.text


def test_a_board_deleted_during_upload_keeps_no_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    board = new_board(client)
    app = client.app
    assert isinstance(app, FastAPI)
    database: Database = app.state.database
    save = FileStore.save

    async def save_then_delete_board(
        self: FileStore, board_id: uuid.UUID, file_id: uuid.UUID, chunks: AsyncIterator[bytes]
    ) -> Any:
        saved = await save(self, board_id, file_id, chunks)
        async with database.sessions() as db:
            await db.execute(delete(Board).where(Board.id == board_id))
            await db.commit()
        return saved

    monkeypatch.setattr(FileStore, "save", save_then_delete_board)
    response = upload(client, board["id"], PNG)
    assert response.status_code == 404
    assert stored_names(client, board["id"]) == []


def test_an_aborted_upload_leaves_nothing(client: TestClient) -> None:
    """Браузер закрыли посреди загрузки: ни файла на диске, ни записи в базе."""
    board = new_board(client)
    app = client.app
    assert isinstance(app, FastAPI)
    path = files_url(board["id"])
    messages: list[Message] = [{"type": "http.request", "body": PNG, "more_body": True}]
    sent: list[Message] = []

    async def receive() -> Message:
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"cookie", f"{COOKIE_NAME}={client.cookies[COOKIE_NAME]}".encode()),
            (b"x-file-name", b"a.png"),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }

    async def call() -> None:
        await app(scope, receive, send)

    assert client.portal is not None
    client.portal.call(call)
    assert sent[0]["status"] == 400
    assert stored_names(client, board["id"]) == []
    assert file_rows(client, board["id"]) == 0


async def test_large_files_are_written_in_batches(tmp_path: Path) -> None:
    files = FileStore(tmp_path, max_size=WRITE_BATCH * 3)
    piece = bytes(range(256)) * 256

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(WRITE_BATCH * 2 // len(piece) + 1):
            yield piece

    board_id, file_id = uuid.uuid4(), uuid.uuid4()
    saved = await files.save(board_id, file_id, chunks())
    content = files.path(board_id, file_id).read_bytes()
    assert saved.size == len(content) > WRITE_BATCH * 2
    assert content == piece * (len(content) // len(piece))


async def test_a_failed_upload_leaves_no_partial_file(tmp_path: Path) -> None:
    files = FileStore(tmp_path, max_size=100)

    async def chunks() -> AsyncIterator[bytes]:
        yield PNG
        yield bytes(100)

    board_id = uuid.uuid4()
    with pytest.raises(FileTooLargeError):
        await files.save(board_id, uuid.uuid4(), chunks())
    assert list((tmp_path / str(board_id)).iterdir()) == []
    # Удаление доски без файлов — не ошибка.
    await files.delete_board(uuid.uuid4())


async def save_bytes(files: FileStore, board_id: uuid.UUID, content: bytes) -> uuid.UUID:
    async def chunks() -> AsyncIterator[bytes]:
        yield content

    file_id = uuid.uuid4()
    await files.save(board_id, file_id, chunks())
    return file_id


async def test_a_copied_board_shares_files_on_disk(tmp_path: Path) -> None:
    files = FileStore(tmp_path, max_size=1000)
    source, target = uuid.uuid4(), uuid.uuid4()
    file_id = await save_bytes(files, source, PNG)

    await files.copy_board(source, target, [file_id])
    original, copy = files.path(source, file_id), files.path(target, file_id)
    assert copy.read_bytes() == PNG
    assert copy.stat().st_ino == original.stat().st_ino
    await files.delete_board(source)
    assert copy.read_bytes() == PNG


async def test_files_are_copied_where_hard_links_are_not_supported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    files = FileStore(tmp_path, max_size=1000)
    source, target = uuid.uuid4(), uuid.uuid4()
    file_id = await save_bytes(files, source, PNG)

    def no_links(*_: object) -> None:
        raise OSError(errno.EXDEV, "жёсткие ссылки не поддерживаются")

    monkeypatch.setattr(os, "link", no_links)
    await files.copy_board(source, target, [file_id])
    copy = files.path(target, file_id)
    assert copy.read_bytes() == PNG
    assert copy.stat().st_ino != files.path(source, file_id).stat().st_ino


async def test_a_file_missing_on_disk_is_skipped_when_copying(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    files = FileStore(tmp_path, max_size=1000)
    source, target = uuid.uuid4(), uuid.uuid4()
    kept = await save_bytes(files, source, PNG)
    lost = uuid.uuid4()

    with caplog.at_level(logging.WARNING):
        await files.copy_board(source, target, [lost, kept])
    assert files.path(target, kept).read_bytes() == PNG
    assert not files.path(target, lost).exists()
    assert str(lost) in caplog.text
