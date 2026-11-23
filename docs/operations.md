# Эксплуатация

Как установить Whatever на сервер, открыть по HTTPS, обновлять, делать резервные копии
и следить за работой. Все команды выполняются в папке репозитория на сервере.

## Из чего состоит

| Сервис | Образ | Что делает |
| --- | --- | --- |
| `frontend` | nginx без прав root | отдаёт приложение, проксирует `/api` и `/ws` на бэкенд; единственный сервис, доступный снаружи |
| `backend` | Python 3.12, uvicorn | API и синхронизация досок, один процесс; картинки и вложения досок — том `files-data` |
| `migrate` | тот же, что `backend` | применяет миграции базы и завершается; бэкенд стартует после него |
| `postgres` | PostgreSQL 16 | данные; том `postgres-data` |

У каждого долгоживущего сервиса есть healthcheck: `docker compose ps` показывает `healthy`,
когда сервис готов. nginx запускается только после того, как бэкенд стал здоровым,
а бэкенд — после успешных миграций.

## Требования

- Linux с Docker и плагином Compose v2.20 или новее.
- Для начала — 2 ядра и 2 ГБ памяти и место на диске под базу и резервные копии.
  Точные требования для 100 одновременных участников покажет нагрузочный тест, он в плане.
- Открытый порт приложения (по умолчанию 8080) или внешний прокси с TLS перед ним.

## Установка

```bash
git clone https://github.com/smesherlu23-cmd/whatever.git && cd whatever
cp .env.example .env
nano .env                                   # задайте POSTGRES_PASSWORD
docker compose up -d --build --wait
docker compose exec backend python -m app.cli create-admin admin --name "Иван Иванов"
```

`--wait` дожидается, пока все сервисы станут здоровыми, и завершается ошибкой, если этого
не случилось. Пароль базы задаётся один раз: с ним PostgreSQL создаёт базу при первом запуске.

## Настройки

Все настройки — в `.env`, полный список с пояснениями — в [.env.example](../.env.example).
После изменения `.env` пересоздайте контейнеры: `docker compose up -d`.

Бэкенд проверяет настройки при запуске. Если значение неверное, контейнер не запустится,
а в `docker compose logs backend` будет указано, какая переменная и что с ней не так.

История версий досок хранится в базе. Версия — доска целиком, поэтому от настроек
`WHATEVER_VERSION_INTERVAL_MINUTES` (как часто сохраняется версия, пока доску меняют)
и `WHATEVER_VERSION_RETENTION_DAYS` (сколько дней хранятся безымянные версии) зависит,
как быстро растёт база. Названные версии хранятся, пока их не удалят.

## HTTPS

Приложение само TLS не завершает: перед ним ставят прокси с сертификатом компании.
Например, Caddy или nginx на том же сервере:

```nginx
server {
    listen 443 ssl;
    server_name whatever.example.local;
    ssl_certificate     /etc/ssl/whatever.crt;
    ssl_certificate_key /etc/ssl/whatever.key;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;     # для WebSocket синхронизации
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

И в `.env`:

```bash
WHATEVER_COOKIE_SECURE=true                 # cookie входа только по HTTPS
WHATEVER_TRUSTED_PROXY=172.16.0.0/12        # адрес прокси, как его видит контейнер
```

`WHATEVER_TRUSTED_PROXY` нужен защите от подбора пароля: она считает попытки по адресу
пользователя, а без этой настройки все пользователи будут выглядеть как адрес прокси.
Для прокси на том же сервере это подсеть Docker (`172.16.0.0/12`), для отдельного
сервера — его адрес. Указывайте только адрес своего прокси: тому, кому nginx доверяет,
он верит и в заголовке `X-Forwarded-For`.

Прокси должен передавать `Host` без изменений: бэкенд сверяет его с `Origin`, чтобы
отклонять запросы с чужих сайтов.

## Обновление

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > before-update.dump
git pull
docker compose up -d --build --wait --remove-orphans
```

Миграции применяются автоматически: сервис `migrate` выполнит их до старта нового бэкенда.
Если миграция не удалась, бэкенд не запустится, а причина будет в `docker compose logs migrate`.
При остановке бэкенд дописывает в базу изменения открытых досок, на это отведено 30 секунд.

### Переход на версию с файлом .env

Раньше пароль базы передавался в команде запуска, а без него был `whatever`. Теперь
он задаётся в `.env` и обязателен. При обновлении такой установки:

1. Создайте `.env` из `.env.example` и укажите в `POSTGRES_PASSWORD` прежний пароль
   (`whatever`, если его не задавали). База уже создана с ним, и другой пароль она не примет.
2. Если пароль был `whatever`, смените его (см. ниже «Смена пароля базы»).
3. Запустите с `--remove-orphans`: это удалит контейнер Redis, который больше не нужен.

## Резервное копирование

Данные лежат в двух местах: в базе (доски, учётные записи, права) и в томе `files-data`
(картинки и вложения досок). Копируйте оба, сначала базу, потом файлы: тогда в копии
будут все файлы, о которых знает база.

```bash
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > whatever-$(date +%F).dump
docker compose exec -T backend tar -C /var/lib/whatever/files -cz . > whatever-files-$(date +%F).tar.gz
```

Копию можно делать на работающем приложении. Для ежедневных копий — строки cron
(`crontab -e`), которые хранят копии 14 дней:

```cron
0 3 * * * cd /opt/whatever && docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/whatever-$(date +\%F).dump && docker compose exec -T backend tar -C /var/lib/whatever/files -cz . > backups/whatever-files-$(date +\%F).tar.gz
30 3 * * * cd /opt/whatever && find backups -name 'whatever-*' -mtime +14 -delete
```

Храните копии не только на этом сервере.

### Восстановление

```bash
docker compose stop backend                 # чтобы никто не писал в базу
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < whatever-2026-11-22.dump
docker compose run --rm --no-deps -T backend tar -C /var/lib/whatever/files -xz < whatever-files-2026-11-22.tar.gz
docker compose start backend
```

У участников, которые открывали доски после создания копии, в браузере остались более
новые версии этих досок. Когда они откроют доску снова, эти изменения вернутся на сервер:
так устроена работа без сети.

## Журналы и наблюдение

```bash
docker compose ps                           # состояние и здоровье сервисов
docker compose logs -f backend              # журнал бэкенда
curl -s http://localhost:8080/api/health    # 200 — всё в порядке, 503 — база недоступна
```

Журналы контейнеров ограничены: до 5 файлов по 10 МБ на сервис. Для сборщиков журналов
(Loki, ELK, Vector) включите `WHATEVER_LOG_FORMAT=json`: каждая запись станет одной строкой
JSON с временем в UTC. Успешные проверки здоровья в журнал доступа не пишутся.

## Смена пароля базы

```bash
docker compose exec postgres psql -U whatever -d whatever -c '\password whatever'
```

Затем укажите новый пароль в `POSTGRES_PASSWORD` в `.env` и перезапустите: `docker compose up -d`.

## Ограничения

Бэкенд работает одним процессом: комнаты досок живут в его памяти. Запускать несколько
копий бэкенда нельзя, пока комнаты не начнут обмениваться изменениями через Redis
(см. [ARCHITECTURE.md](../ARCHITECTURE.md)).
