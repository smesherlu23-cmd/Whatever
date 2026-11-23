import { expect, test } from '@playwright/test';
import {
  type Box,
  drawRectangle,
  ink,
  newBoard,
  openAs,
  openBoard,
  serverElements,
  share,
} from './helpers';

const LEFT: Box = { x: 200, y: 150, w: 160, h: 100 };
const RIGHT: Box = { x: 500, y: 150, w: 160, h: 100 };

test('two people on one board see each other’s shapes', async ({ browser }) => {
  const alice = await openAs(browser, 'alice');
  const bob = await openAs(browser, 'bob');
  const board = await newBoard(alice, 'Совместная работа');
  await share(alice, board, 'bob', 'editor');
  await openBoard(alice, board);
  await openBoard(bob, board);
  const blank = await ink(bob, LEFT);

  await drawRectangle(alice, LEFT);

  await expect.poll(() => serverElements(alice, board)).toBe(1);
  await expect.poll(() => ink(bob, LEFT)).toBeGreaterThan(blank);

  await drawRectangle(bob, RIGHT);
  await expect.poll(() => serverElements(alice, board)).toBe(2);
  await expect.poll(() => ink(alice, RIGHT)).toBeGreaterThan(blank);
});

test('a shape drawn offline reaches the others after reconnecting', async ({ browser }) => {
  const alice = await openAs(browser, 'alice');
  const bob = await openAs(browser, 'bob');
  const board = await newBoard(alice, 'Без сети');
  await share(alice, board, 'bob', 'editor');
  await openBoard(alice, board);
  await openBoard(bob, board);
  const blank = await ink(alice, RIGHT);

  await bob.context().setOffline(true);
  await drawRectangle(bob, RIGHT);
  // Без сети фигура есть у Бориса, но не на сервере и не у Алисы.
  await expect.poll(() => ink(bob, RIGHT)).toBeGreaterThan(blank);
  expect(await serverElements(alice, board)).toBe(0);

  await bob.context().setOffline(false);
  await expect.poll(() => serverElements(alice, board), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => ink(alice, RIGHT)).toBeGreaterThan(blank);
});

test('a viewer sees the board but cannot change it', async ({ browser }) => {
  const alice = await openAs(browser, 'alice');
  const vera = await openAs(browser, 'vera');
  const board = await newBoard(alice, 'Только просмотр');
  await share(alice, board, 'vera', 'viewer');
  await openBoard(alice, board);
  await drawRectangle(alice, LEFT);
  await expect.poll(() => serverElements(alice, board)).toBe(1);

  await openBoard(vera, board, 'viewer');
  await expect(vera.getByText('Только просмотр')).toBeVisible();
  // Открытая заново доска показывает своё содержимое в середине экрана, поэтому смотрим на всю сцену.
  await expect.poll(() => ink(vera)).toBeGreaterThan(0);
  await drawRectangle(vera, RIGHT);
  await vera.keyboard.press('Control+A');
  await vera.keyboard.press('Delete');
  // Сервер не принял от зрителя ничего: фигура Алисы на месте, новой нет.
  await vera.waitForTimeout(1000);
  expect(await serverElements(alice, board)).toBe(1);
});

test('a board keeps its shapes after the page is reloaded', async ({ browser }) => {
  const alice = await openAs(browser, 'alice');
  const board = await newBoard(alice, 'После перезагрузки');
  await openBoard(alice, board);
  await drawRectangle(alice, LEFT);
  await expect.poll(() => serverElements(alice, board)).toBe(1);

  // Новый браузер без локальной копии: доска приходит только с сервера и открывается
  // с фигурой в середине экрана, поэтому смотрим на всю сцену.
  const again = await openAs(browser, 'alice');
  await openBoard(again, board);
  await expect.poll(() => ink(again)).toBeGreaterThan(0);
});
