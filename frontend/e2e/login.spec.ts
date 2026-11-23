import { expect, test } from '@playwright/test';
import { users } from './users';

test('wrong password is refused, the right one opens the board list', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Логин').fill(users.alice.login);
  await page.getByLabel('Пароль').fill('не тот пароль');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toContainText('Неверный логин или пароль');

  await page.getByLabel('Пароль').fill(users.alice.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: users.alice.name })).toBeVisible();
});
