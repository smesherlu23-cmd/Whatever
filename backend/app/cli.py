"""Служебные команды. Запуск на сервере:

    docker compose exec backend python -m app.cli create-admin admin --name "Администратор"

Пароль запрашивается без отображения на экране, либо читается из stdin с --password-stdin.
"""

import argparse
import asyncio
import getpass
import sys

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from app.api.schemas import Login, Password, PersonName
from app.auth.passwords import hash_password
from app.db import dispose_engine, session_factory
from app.models import Role, User


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    password = getpass.getpass("Пароль: ")
    if password != getpass.getpass("Повторите пароль: "):
        raise SystemExit("Пароли не совпадают")
    return password


async def create_admin(login: str, name: str, password: str) -> None:
    async with session_factory()() as db:
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
    await dispose_engine()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-admin", help="создать администратора")
    create.add_argument("login")
    create.add_argument("--name", default="Администратор")
    create.add_argument("--password-stdin", action="store_true")
    args = parser.parse_args(argv)

    try:
        login = TypeAdapter(Login).validate_python(args.login)
        name = TypeAdapter(PersonName).validate_python(args.name)
        password = TypeAdapter(Password).validate_python(_read_password(args.password_stdin))
    except ValidationError as error:
        raise SystemExit(f"Неверные данные: {error.errors()[0]['msg']}") from None
    asyncio.run(create_admin(login, name, password))
    print(f"Администратор {login} создан")


if __name__ == "__main__":
    main()
