# Сквозные тесты

Тесты в настоящем браузере (Playwright, Chromium) против приложения, запущенного так же,
как на сервере: вход, совместная работа двух людей на одной доске, работа без сети, права
зрителя. Их запускает CI в job Docker; локально:

```bash
docker compose up -d --build --wait
printf 'admin-password\n' | docker compose exec -T backend python -m app.cli create-admin e2e-admin --password-stdin
cd frontend
npx playwright install chromium          # один раз
E2E_ADMIN_LOGIN=e2e-admin E2E_ADMIN_PASSWORD=admin-password npm run e2e
```

`E2E_URL` — адрес приложения, по умолчанию `http://localhost:8080`. Пользователей тестов
(`e2e-alice`, `e2e-bob`, `e2e-vera`) создаёт `global-setup.ts`; тесты создают свои доски.
