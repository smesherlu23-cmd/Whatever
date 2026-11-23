import { defineConfig, devices } from '@playwright/test';

/*
 * Сквозные тесты в настоящем браузере против приложения, запущенного как на сервере
 * (docker compose up). Адрес и администратор — из окружения, см. e2e/README.md.
 */
export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  outputDir: '../test-results',
  // Тесты работают с одной базой и общими пользователями: по очереди проще и надёжнее.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:8080',
    colorScheme: 'light',
    locale: 'ru-RU',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
