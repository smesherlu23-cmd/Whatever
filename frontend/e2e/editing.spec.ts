import { type Page, expect, test } from '@playwright/test';
import {
  type Box,
  drawRectangle,
  newBoard,
  openAs,
  openBoard,
  serverElements,
  share,
} from './helpers';

const SHAPE: Box = { x: 300, y: 200, w: 200, h: 120 };
const OTHER: Box = { x: 600, y: 200, w: 160, h: 100 };

/** Точка холста в координатах окна. */
async function onCanvas(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const origin = await page.getByLabel('Холст доски').boundingBox();
  if (!origin) throw new Error('Холст не на экране');
  return { x: origin.x + x, y: origin.y + y };
}

test('shapes are deleted with the Delete key and from the context menu', async ({ browser }) => {
  const alice = await openAs(browser, 'alice');
  const board = await newBoard(alice, 'Удаление');
  await openBoard(alice, board);
  await drawRectangle(alice, SHAPE);
  await drawRectangle(alice, OTHER);
  await expect.poll(() => serverElements(alice, board)).toBe(2);

  // Только что нарисованная фигура выделена: Delete удаляет её.
  await alice.keyboard.press('Delete');
  await expect.poll(() => serverElements(alice, board)).toBe(1);

  const inside = await onCanvas(alice, SHAPE.x + SHAPE.w / 2, SHAPE.y + SHAPE.h / 2);
  await alice.mouse.click(inside.x, inside.y, { button: 'right' });
  const menu = alice.getByRole('menu', { name: 'Действия с выделенным' });
  await menu.getByRole('menuitem', { name: /Удалить/ }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => serverElements(alice, board)).toBe(0);

  // Удаление отменяется, как любая правка.
  await alice.keyboard.press('Control+z');
  await expect.poll(() => serverElements(alice, board)).toBe(1);
});

test('a discussion is written right after placing its pin and seen by others', async ({
  browser,
}) => {
  const alice = await openAs(browser, 'alice');
  const bob = await openAs(browser, 'bob');
  const board = await newBoard(alice, 'Обсуждения');
  await share(alice, board, 'bob', 'editor');
  await openBoard(alice, board);
  await openBoard(bob, board);
  await drawRectangle(alice, SHAPE);

  await alice.keyboard.press('KeyC');
  const at = await onCanvas(alice, SHAPE.x + SHAPE.w / 2, SHAPE.y + SHAPE.h / 2);
  await alice.mouse.click(at.x, at.y);
  // Поле уже в фокусе: набранный текст попадает в него, а не в сочетания клавиш доски.
  await expect(alice.getByRole('textbox', { name: 'Текст обсуждения' })).toBeFocused();
  await alice.keyboard.type('Почему здесь кэш?');
  await alice.keyboard.press('Enter');

  const pin = bob.getByRole('button', { name: 'Обсуждение: Алиса: Почему здесь кэш?' });
  await expect(pin).toBeVisible();
  // При наведении метка увеличивается на месте и остаётся под указателем.
  const before = await pin.boundingBox();
  if (!before) throw new Error('Метки нет на экране');
  await bob.mouse.move(before.x + 6, before.y + before.height - 6);
  await expect(async () => {
    const hovered = await pin.boundingBox();
    expect(hovered?.width).toBeGreaterThan(before.width);
    expect(Math.abs((hovered?.x ?? 0) - before.x)).toBeLessThan(1);
    expect(
      Math.abs((hovered?.y ?? 0) + (hovered?.height ?? 0) - before.y - before.height),
    ).toBeLessThan(1);
  }).toPass();
  await pin.click();
  await expect(bob.getByRole('list', { name: 'Комментарии' })).toContainText('Почему здесь кэш?');
});
