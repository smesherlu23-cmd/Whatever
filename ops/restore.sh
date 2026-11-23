#!/bin/sh
# Восстановление Whatever из резервной копии ops/backup.sh. Запускается на сервере из папки
# репозитория, копия задаётся именем в папке копий (WHATEVER_BACKUP_DIR):
#
#     ops/restore.sh whatever-2026-11-23T0000      (или make restore BACKUP=...)
#
# Заменяет базу и файлы досок содержимым копии. На время восстановления бэкенд
# останавливается, чтобы никто не писал в базу. Копии читает контейнер backup: на сервере
# они доступны только root, а этот скрипт можно запускать от пользователя группы docker.
# Команды для контейнера в одинарных кавычках: $1 и $PGDATABASE раскрывает он, а не мы.
# shellcheck disable=SC2016
set -eu

if [ $# -ne 1 ]; then
    echo "usage: ops/restore.sh whatever-<дата>   (имя копии без расширения)" >&2
    exit 2
fi
name=$(basename "${1%.dump}")

# Команда в одноразовом контейнере сервиса backup: у него есть папка копий и доступ к базе.
in_backup() {
    docker compose run --rm --no-deps -T --entrypoint sh backup -c "$1" restore "$name"
}

in_backup 'test -f "/backups/$1.dump" && test -f "/backups/$1.files.tar.gz"' || {
    echo "В папке копий нет $name.dump и $name.files.tar.gz" >&2
    exit 1
}

docker compose stop backend
in_backup 'pg_restore --clean --if-exists --no-owner --exit-on-error -d "$PGDATABASE" "/backups/$1.dump"'
# Файлы, которых нет в копии, удаляются: иначе том остался бы смесью двух состояний.
in_backup 'cat "/backups/$1.files.tar.gz"' |
    docker compose run --rm --no-deps -T --entrypoint sh backend -c \
        'find /var/lib/whatever/files -mindepth 1 -delete && tar -C /var/lib/whatever/files -xzf -'
docker compose up -d --wait backend
echo "Восстановлено из $name"
