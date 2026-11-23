# syntax=docker/dockerfile:1
# Образ фронтенда: собранная статика и nginx, который проксирует /api и /ws на бэкенд.

ARG NODE_VERSION=22

# ---------- Сборка ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Рабочий образ: nginx без прав root, слушает порт 8080 ----------
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
# Исправления безопасности Alpine, вышедшие после сборки базового образа: Trivy в CI
# не пропускает уязвимость, для которой исправление уже есть. Пакеты ставит root, nginx
# работает от своего пользователя, как и в базовом образе.
USER 0
RUN apk upgrade --no-cache
USER 101
# Шаблон конфигурации: при запуске в него подставляются только переменные WHATEVER_*,
# переменные самого nginx ($uri, $remote_addr) остаются как есть.
ENV NGINX_ENVSUBST_FILTER=^WHATEVER_ \
    WHATEVER_TRUSTED_PROXY=127.0.0.1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/nginx-health"]
