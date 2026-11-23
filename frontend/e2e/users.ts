import { fileURLToPath } from 'node:url';

/** Пользователи сквозных тестов. Их создаёт global-setup через API администратора. */

export interface TestUser {
  login: string;
  name: string;
  password: string;
}

const PASSWORD = 'e2e-password-123';

export const users = {
  alice: { login: 'e2e-alice', name: 'Алиса', password: PASSWORD },
  bob: { login: 'e2e-bob', name: 'Борис', password: PASSWORD },
  vera: { login: 'e2e-vera', name: 'Вера', password: PASSWORD },
} satisfies Record<string, TestUser>;

export type UserKey = keyof typeof users;

export const userKeys: readonly UserKey[] = ['alice', 'bob', 'vera'];

/** Файл с cookie входа пользователя: тесты открывают браузер уже вошедшими. */
export const storageState = (key: UserKey): string =>
  fileURLToPath(new URL(`.auth/${key}.json`, import.meta.url));
