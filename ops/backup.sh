#!/bin/sh
# Резервная копия Whatever: база (pg_dump -Fc) и файлы досок (tar.gz) с общей отметкой
# времени, плюс удаление копий старше BACKUP_KEEP_DAYS дней.
#
# Работает в сервисе backup из docker-compose.yml (образ postgres, файлы досок подключены
# только для чтения):
#
#     backup.sh once       одна копия сейчас (make backup)
#     backup.sh schedule   копия каждый день в BACKUP_HOUR часов по UTC
#
# Сначала копируется база, потом файлы: так в копии есть все файлы, о которых знает база.
# Каждый файл пишется под временным именем и переименовывается, только когда записан
# целиком, поэтому оборванная копия не выдаёт себя за готовую.
set -eu
# В копии хеши паролей и все доски: читать её может только владелец папки копий.
umask 077

: "${BACKUP_DIR:=/backups}"
: "${BACKUP_FILES_DIR:=/files}"
: "${BACKUP_HOUR:=0}"
: "${BACKUP_KEEP_DAYS:=14}"

log() {
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') backup: $*"
}

# Внутри функции, вызванной из if, set -e не действует, поэтому каждая ошибка
# обрабатывается явно.
backup_once() {
    stamp=$(date -u '+%Y-%m-%dT%H%M')
    base="$BACKUP_DIR/whatever-$stamp"
    pg_dump -Fc --file="$base.dump.part" || return 1
    tar -C "$BACKUP_FILES_DIR" -czf "$base.files.tar.gz.part" . || return 1
    mv "$base.dump.part" "$base.dump" || return 1
    mv "$base.files.tar.gz.part" "$base.files.tar.gz" || return 1
    log "saved $base.dump and $base.files.tar.gz"
    find "$BACKUP_DIR" -maxdepth 1 -name 'whatever-*' -mtime +"$BACKUP_KEEP_DAYS" -print -delete
}

# Сколько секунд до ближайших BACKUP_HOUR:00 по UTC (сутки, если это время уже наступило).
seconds_until_backup() {
    now=$(date -u +%s)
    wait=$(( (BACKUP_HOUR * 3600 - now % 86400 + 86400) % 86400 ))
    echo $(( wait == 0 ? 86400 : wait ))
}

case "${1:-}" in
    once)
        backup_once
        ;;
    schedule)
        log "daily at ${BACKUP_HOUR}:00 UTC into $BACKUP_DIR, keeping $BACKUP_KEEP_DAYS days"
        while true; do
            sleep "$(seconds_until_backup)"
            # Неудачная копия не останавливает расписание: следующая попытка — через сутки,
            # а ошибка видна в docker compose logs backup.
            if ! backup_once; then
                log "FAILED, see the error above"
                rm -f "$BACKUP_DIR"/*.part
            fi
        done
        ;;
    *)
        echo "usage: backup.sh once|schedule" >&2
        exit 2
        ;;
esac
