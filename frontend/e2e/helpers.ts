import { type Browser, type Page, expect } from '@playwright/test';
import * as Y from 'yjs';
import { type UserKey, storageState, users } from './users';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Браузер пользователя, уже вошедшего в систему. */
export async function openAs(browser: Browser, key: UserKey): Promise<Page> {
  const context = await browser.newContext({ storageState: storageState(key) });
  return context.newPage();
}

/** Новая доска пользователя page; возвращает её id. */
export async function newBoard(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/boards', {
    data: { name },
    headers: { Origin: originOf(page) },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

/** Даёт пользователю who роль на доске. Запрос идёт от имени владельца owner. */
export async function share(
  owner: Page,
  boardId: string,
  who: UserKey,
  role: 'editor' | 'viewer',
): Promise<void> {
  const people = await owner.request.get('/api/users');
  expect(people.ok()).toBe(true);
  const list = (await people.json()) as { id: string; login: string }[];
  const user = list.find((candidate) => candidate.login === users[who].login);
  if (!user) throw new Error(`Нет пользователя ${users[who].login}`);
  const response = await owner.request.put(`/api/boards/${boardId}/members/${user.id}`, {
    data: { role },
    headers: { Origin: originOf(owner) },
  });
  expect(response.ok()).toBe(true);
}

/**
 * Открывает доску и ждёт, пока на ней можно работать: зрителю — пока видна доска, остальным —
 * пока придут права и появятся инструменты. До этого доска открыта только для просмотра.
 */
export async function openBoard(
  page: Page,
  boardId: string,
  as: 'editor' | 'viewer' = 'editor',
): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await expect(page.getByLabel('Холст доски')).toBeVisible();
  if (as === 'editor') {
    await expect(page.getByRole('button', { name: /^Прямоугольник/ })).toBeVisible();
  }
}

/** Рисует прямоугольник по диагонали box (координаты холста в CSS-пикселях). */
export async function drawRectangle(page: Page, box: Box): Promise<void> {
  const canvas = page.getByLabel('Холст доски');
  const origin = await canvas.boundingBox();
  if (!origin) throw new Error('Холст не на экране');
  await page.keyboard.press('KeyR');
  await page.mouse.move(origin.x + box.x, origin.y + box.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + box.x + box.w, origin.y + box.y + box.h, { steps: 8 });
  await page.mouse.up();
}

/** Сколько элементов на доске по данным сервера. */
export async function serverElements(page: Page, boardId: string): Promise<number> {
  const response = await page.request.get(`/api/boards/${boardId}/content`);
  expect(response.ok()).toBe(true);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await response.body());
  return doc.getMap('elements').size;
}

/**
 * Сколько тёмных точек нарисовано в области box слоя сцены (без box — на всей сцене): так тест видит фигуру,
 * не завися от того, как именно она нарисована. Фон и сетка светлые, ещё не нарисованный
 * холст прозрачен.
 */
export async function ink(page: Page, box?: Box): Promise<number> {
  return page.evaluate((area) => {
    const scene = document.querySelector<HTMLCanvasElement>('canvas[aria-hidden="true"]');
    const ctx = scene?.getContext('2d');
    if (!scene || !ctx) return 0;
    const scale = scene.width / scene.clientWidth;
    const { x, y, w, h } = area ?? { x: 0, y: 0, w: scene.clientWidth, h: scene.clientHeight };
    const { data } = ctx.getImageData(
      Math.round(x * scale),
      Math.round(y * scale),
      Math.round(w * scale),
      Math.round(h * scale),
    );
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Прозрачная точка — кадр ещё не нарисован, а не тёмная краска.
      if ((data[i + 3] ?? 0) < 128) continue;
      const luminance =
        0.299 * (data[i] ?? 255) + 0.587 * (data[i + 1] ?? 255) + 0.114 * (data[i + 2] ?? 255);
      if (luminance < 100) dark += 1;
    }
    return dark;
  }, box);
}

function originOf(page: Page): string {
  return new URL(page.url() === 'about:blank' ? baseURL() : page.url()).origin;
}

function baseURL(): string {
  return process.env.E2E_URL ?? 'http://localhost:8080';
}
