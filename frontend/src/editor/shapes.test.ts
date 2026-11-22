import { describe, expect, it } from 'vitest';
import { arrows, defined, shapes } from '../testing/helpers';
import { Editor } from './Editor';

function drag(editor: Editor, from: [number, number], to: [number, number]) {
  editor.pointerDown({ x: from[0], y: from[1] });
  editor.pointerMove({ x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2 });
  editor.pointerMove({ x: to[0], y: to[1] });
  editor.pointerUp();
}

function click(editor: Editor, at: [number, number]) {
  editor.pointerDown({ x: at[0], y: at[1] });
  editor.pointerUp();
}

describe('Editor with shapes from the catalog', () => {
  it('places a shape with its preset text and catalog size', () => {
    const editor = new Editor();
    editor.setTool('class', { text: 'Заказ\n--\nid: uuid' });
    click(editor, [300, 300]);
    expect(shapes(editor.doc)[0]).toMatchObject({
      kind: 'class',
      text: 'Заказ\n--\nid: uuid',
      w: 200,
      h: 130,
      x: 200,
    });
    // Заготовка действует на одну фигуру.
    editor.setTool('class');
    click(editor, [800, 300]);
    expect(shapes(editor.doc)[1]).toMatchObject({ text: '' });
    // Заготовка не переживает смену инструмента на не-фигуру.
    editor.setTool('rectangle', { size: { w: 10, h: 10 } });
    editor.setTool('arrow');
    editor.setTool('rectangle');
    click(editor, [0, 600]);
    expect(shapes(editor.doc)[2]).toMatchObject({ w: 160, h: 80 });
  });

  it('puts a new container under everything already drawn', () => {
    const editor = new Editor();
    editor.setTool('rectangle');
    drag(editor, [100, 100], [200, 200]);
    editor.setTool('frame');
    drag(editor, [0, 0], [500, 400]);
    const [frame, rect] = shapes(editor.doc);
    expect(frame?.kind).toBe('frame');
    expect(defined(frame).z).toBeLessThan(defined(rect).z);
  });

  it('carries what lies in a container when the container is dragged', () => {
    const editor = new Editor();
    editor.setTool('frame');
    drag(editor, [0, 0], [500, 400]);
    editor.setTool('rectangle');
    drag(editor, [100, 100], [200, 200]);
    editor.setTool('rectangle');
    drag(editor, [600, 100], [700, 200]);
    editor.setTool('arrow');
    drag(editor, [250, 300], [400, 300]);
    const [frame, inside, outside] = shapes(editor.doc);
    const free = defined(arrows(editor.doc)[0]);

    // Рамку берут за заголовок: внутри неё указатель проходит к фигурам.
    editor.select([]);
    drag(editor, [250, 10], [300, 60]);
    expect(editor.selection).toEqual(new Set([defined(frame).id]));
    expect(editor.doc.get(defined(inside).id)).toMatchObject({ x: 150, y: 150 });
    expect(editor.doc.get(defined(outside).id)).toMatchObject({ x: 600, y: 100 });
    expect(editor.doc.get(free.id)).toMatchObject({ start: { x: 300, y: 350 } });

    // Одно Ctrl+Z возвращает всё на место.
    editor.undo();
    expect(editor.doc.get(defined(inside).id)).toMatchObject({ x: 100, y: 100 });
  });

  it('attaches a message to a lifeline at the height where it starts', () => {
    const editor = new Editor();
    editor.setTool('lifeline');
    drag(editor, [0, 0], [120, 400]);
    editor.setTool('lifeline');
    drag(editor, [400, 0], [520, 400]);
    editor.setTool('arrow');
    drag(editor, [60, 150], [460, 150]);
    const message = defined(arrows(editor.doc)[0]);
    expect(message.start).toMatchObject({ anchor: { x: 0.5, y: 0.375 } });
    expect(message.end).toMatchObject({ anchor: { x: 0.5, y: 0.375 } });
  });
});
