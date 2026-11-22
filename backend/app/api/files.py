"""Картинки и вложения: загрузка на доску и скачивание."""

import logging
import uuid
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Header, HTTPException, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from starlette.requests import ClientDisconnect

from app.auth.dependencies import EditableBoard, FileStorage, ViewableBoard
from app.core.db import DbSession
from app.files import IMAGE_TYPES, FileTooLargeError
from app.models import BoardFile

log = logging.getLogger(__name__)

router = APIRouter(prefix="/boards/{board_id}/files", tags=["files"])

NAME_LIMIT = 255
DEFAULT_NAME = "файл"

DOWNLOAD_HEADERS = {
    # Содержимое файла с этим id не меняется никогда.
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    # Если файл всё же откроют как страницу, скрипты в нём не выполнятся.
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


class FileOut(BaseModel):
    id: uuid.UUID
    name: str
    content_type: str
    size: int


def file_name(header: str) -> str:
    """Имя файла из заголовка X-File-Name. Клиент кодирует его как часть URL: в заголовках
    допустима только латиница. От пути остаётся последняя часть, управляющие символы
    убираются."""
    name = unquote(header).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(char for char in name if char.isprintable()).strip()
    return name[:NAME_LIMIT] or DEFAULT_NAME


def too_large(limit: int) -> HTTPException:
    return HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE, f"Файл больше {limit // (1024 * 1024)} МБ"
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_file(
    target: EditableBoard,
    request: Request,
    db: DbSession,
    files: FileStorage,
    name: Annotated[str, Header(alias="X-File-Name")] = "",
) -> FileOut:
    """Принимает файл телом запроса, без multipart: так он сразу пишется на диск по частям."""
    board_id = target.board.id
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > files.max_size:
        raise too_large(files.max_size)
    file_id = uuid.uuid4()
    try:
        saved = await files.save(board_id, file_id, request.stream())
    except FileTooLargeError:
        raise too_large(files.max_size) from None
    except ClientDisconnect:
        # Отвечать уже некому; ответ нужен, чтобы обрыв не попал в журнал как сбой сервера.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Загрузка прервана") from None
    record = BoardFile(
        board_id=board_id,
        id=file_id,
        name=file_name(name),
        content_type=saved.content_type,
        size=saved.size,
        uploaded_by_id=target.user.id,
    )
    db.add(record)
    try:
        await db.commit()
    except IntegrityError:
        # Доску удалили, пока файл загружался.
        await files.delete(board_id, file_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Доска не найдена") from None
    return FileOut(
        id=record.id, name=record.name, content_type=record.content_type, size=record.size
    )


@router.get("/{file_id}")
async def download_file(
    target: ViewableBoard, file_id: uuid.UUID, db: DbSession, files: FileStorage
) -> FileResponse:
    """Картинки открываются в браузере, остальные файлы скачиваются под своим именем."""
    board_id = target.board.id
    record = await db.get(BoardFile, (board_id, file_id))
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    stat = await files.stat(board_id, file_id)
    if stat is None:
        log.warning("Файл %s доски %s есть в базе, но не найден на диске", file_id, board_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    inline = record.content_type in IMAGE_TYPES
    return FileResponse(
        files.path(board_id, file_id),
        stat_result=stat,
        media_type=record.content_type,
        filename=record.name,
        content_disposition_type="inline" if inline else "attachment",
        headers=DOWNLOAD_HEADERS,
    )
