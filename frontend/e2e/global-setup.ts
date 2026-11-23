import { type APIRequestContext, type FullConfig, request } from '@playwright/test';
import { storageState, userKeys, users } from './users';

/**
 * Готовит пользователей и их вход. Входим через API один раз на пользователя: nginx
 * ограничивает частоту входа, а тестам нужен вход, а не форма (её проверяет login.spec.ts).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  const login = process.env.E2E_ADMIN_LOGIN;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!baseURL || !login || !password) {
    throw new Error('Задайте E2E_ADMIN_LOGIN и E2E_ADMIN_PASSWORD (см. e2e/README.md)');
  }
  const admin = await signedIn(baseURL, login, password);
  for (const user of Object.values(users)) {
    const created = await admin.post('/api/admin/users', { data: { ...user, role: 'user' } });
    // 409 — пользователь остался с прошлого запуска.
    if (!created.ok() && created.status() !== 409) {
      throw new Error(`Не удалось создать ${user.login}: ${await created.text()}`);
    }
  }
  await admin.dispose();
  for (const key of userKeys) {
    const { login: userLogin, password: userPassword } = users[key];
    const context = await signedIn(baseURL, userLogin, userPassword);
    await context.storageState({ path: storageState(key) });
    await context.dispose();
  }
}

async function signedIn(
  baseURL: string,
  login: string,
  password: string,
): Promise<APIRequestContext> {
  // Сервер принимает изменяющие запросы только со своего Origin.
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const response = await context.post('/api/auth/login', { data: { login, password } });
  if (!response.ok()) throw new Error(`Вход ${login}: ${String(response.status())}`);
  return context;
}
