"""Служебные команды бэкенда.

    python -m app.cli serve                  запустить сервер (так его запускает образ Docker)
    python -m app.cli serve --reload         то же при разработке: перезапуск при правке кода
    python -m app.cli create-admin admin --name "Администратор"

Пароль администратора запрашивается без отображения на экране, а с --password-stdin
читается из стандартного ввода.
"""

import argparse
import asyncio
import getpass
import sys

import uvicorn
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from app.api.schemas import Login, Password, PersonName
from app.auth.passwords import hash_password
from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.logging import logging_config
from app.models import Role, User
from app.sync.limits import WS_MAX_MESSAGE_BYTES

# Сколько ждать закрытия подключений при остановке, прежде чем записать доски и выйти.
# Должно быть меньше stop_grace_period в docker-compose.yml, иначе Docker прервёт запись.
GRACEFUL_SHUTDOWN_SECONDS = 15


def serve(settings: Settings, *, host: str, port: int, reload: bool) -> None:
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=host,
        port=port,
        reload=reload,
        log_config=logging_config(settings.log_level, settings.log_format),
        # Адрес пользователя берётся из X-Forwarded-For только от доверенного прокси (nginx).
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
        server_header=False,
        ws_max_size=WS_MAX_MESSAGE_BYTES,
    )


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    password = getpass.getpass("Пароль: ")
    if password != getpass.getpass("Повторите пароль: "):
        raise SystemExit("Пароли не совпадают")
    return password


async def create_admin(settings: Settings, login: str, name: str, password: str) -> None:
    database = Database(settings)
    try:
        async with database.sessions() as db:
            existing = await db.scalar(select(User).where(User.login == login))
            if existing is not None:
                raise SystemExit(f"Пользователь {login} уже есть")
            db.add(
                User(
                    login=login,
                    name=name,
                    role=Role.ADMIN,
                    password_hash=await hash_password(password),
                )
            )
            await db.commit()
    finally:
        await database.dispose()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("serve", help="запустить сервер")
    run.add_argument("--host", default="127.0.0.1", help="адрес (по умолчанию 127.0.0.1)")
    run.add_argument("--port", type=int, default=8000, help="порт (по умолчанию 8000)")
    run.add_argument("--reload", action="store_true", help="перезапуск при изменении кода")

    create = commands.add_parser("create-admin", help="создать администратора")
    create.add_argument("login")
    create.add_argument("--name", default="Администратор")
    create.add_argument("--password-stdin", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = _parser().parse_args(argv)
    settings = get_settings()
    if args.command == "serve":
        serve(settings, host=args.host, port=args.port, reload=args.reload)
        return

    try:
        login = TypeAdapter(Login).validate_python(args.login)
        name = TypeAdapter(PersonName).validate_python(args.name)
        password = TypeAdapter(Password).validate_python(_read_password(args.password_stdin))
    except ValidationError as error:
        raise SystemExit(f"Неверные данные: {error.errors()[0]['msg']}") from None
    asyncio.run(create_admin(settings, login, name, password))
    print(f"Администратор {login} создан")


if __name__ == "__main__":
    main()
