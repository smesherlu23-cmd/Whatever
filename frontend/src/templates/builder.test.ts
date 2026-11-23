import { describe, expect, it } from 'vitest';
import { center } from '../model/geometry';
import { SECTION_PADDING, SMALL_LINE_HEIGHT } from '../model/textLayout';
import { DEFAULT_ARROW_STYLE, DEFAULT_PAGE, DEFAULT_STICKY_FILL, isArrow } from '../model/types';
import { TemplateBuilder } from './builder';

describe('TemplateBuilder', () => {
  it('places shapes of catalog size one above another', () => {
    const t = new TemplateBuilder();
    const frame = t.shape('frame', 0, 0, 'Рамка', { w: 600 });
    const sticky = t.shape('sticky', 20, 50, 'Идея');
    expect(frame).toMatchObject({ kind: 'frame', page: DEFAULT_PAGE, w: 600, h: 320 });
    expect(sticky).toMatchObject({ w: 160, h: 160, fill: DEFAULT_STICKY_FILL, text: 'Идея' });
    expect(sticky.z).toBeGreaterThan(frame.z);
    expect(t.board.list()).toEqual([frame, sticky]);
  });

  it('makes classes and entities tall enough for all their rows', () => {
    const t = new TemplateBuilder();
    const entity = t.shape('entity', 0, 0, 'Заказ\n--\nid: uuid\ntotal: numeric');
    const section = (rows: number) => rows * SMALL_LINE_HEIGHT + SECTION_PADDING * 2;
    expect(entity.h).toBe(section(1) + section(2));
  });

  it('names the first page and adds the next ones', () => {
    const t = new TemplateBuilder();
    t.page('Контекст');
    const person = t.shape('person', 0, 0, 'Покупатель');
    t.page('Контейнеры');
    const api = t.shape('rectangle', 0, 0, 'API');
    const [first, second] = t.board.pages();
    expect(first).toMatchObject({ id: DEFAULT_PAGE, name: 'Контекст' });
    expect(second?.name).toBe('Контейнеры');
    expect(person.page).toBe(DEFAULT_PAGE);
    expect(api.page).toBe(second?.id);
  });

  it('binds arrows to the edges of shapes, as the editor does', () => {
    const t = new TemplateBuilder();
    const a = t.shape('rectangle', 0, 0, 'A');
    const b = t.shape('rectangle', 400, 0, 'B');
    const arrow = t.arrow(a, b, { text: 'вызывает', dashed: true });
    expect(arrow).toMatchObject({
      ...DEFAULT_ARROW_STYLE,
      dashed: true,
      text: 'вызывает',
      start: { x: 160, y: 40, shapeId: a.id },
      end: { x: 400, y: 40, shapeId: b.id },
    });
    expect(t.board.list().filter(isArrow)).toEqual([arrow]);
  });

  it('connects lifelines at the height of the message', () => {
    const t = new TemplateBuilder();
    const client = t.shape('lifeline', 0, 0, 'Клиент', { h: 400 });
    const server = t.shape('lifeline', 300, 0, 'Сервер', { h: 400 });
    const message = t.arrow(client, server, { y: 100 });
    expect(message.start).toEqual({
      x: center(client).x,
      y: 100,
      shapeId: client.id,
      anchor: { x: 0.5, y: 0.25 },
    });
    expect(message.end).toMatchObject({ x: center(server).x, y: 100, anchor: { y: 0.25 } });
  });
});
