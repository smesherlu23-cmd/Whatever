import { describe, expect, it } from 'vitest';
import type { Point } from '../model/types';
import { arrows, defined, shapes, takeTwo } from '../testing/helpers';
import { Editor } from './Editor';

function circle(cx: number, cy: number, r: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= 66; i++) {
    const t = (i / 60) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(t) + Math.sin(i * 1.7) * 2, y: cy + r * Math.sin(t) });
  }
  return points;
}

function line(from: Point, to: Point): Point[] {
  return Array.from({ length: 30 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / 29,
    y: from.y + ((to.y - from.y) * i) / 29 + Math.sin(i) * 1.5,
  }));
}

function draw(editor: Editor, points: Point[]) {
  const [first, ...rest] = points;
  editor.pointerDown(defined(first));
  for (const p of rest) editor.pointerMove(p);
  editor.pointerUp();
}

function penEditor(smart = true): Editor {
  const editor = new Editor();
  editor.setTool('pen');
  editor.setSmartDrawing(smart);
  return editor;
}

describe('smart drawing', () => {
  it('turns a rough circle into a neat circle right away', () => {
    const editor = penEditor();
    draw(editor, circle(200, 200, 60));
    const shape = defined(shapes(editor.doc)[0]);
    expect(shape.kind).toBe('ellipse');
    expect(shape.w).toBe(shape.h);
    expect(editor.tool).toBe('pen');
  });

  it('keeps the hand-drawn stroke when smart drawing is off', () => {
    const editor = penEditor(false);
    draw(editor, circle(200, 200, 60));
    expect(editor.doc.list()[0]?.kind).toBe('path');
  });

  it('keeps a scribble that is not like any shape', () => {
    const editor = penEditor();
    draw(editor, [
      { x: 0, y: 0 },
      { x: 40, y: 80 },
      { x: 80, y: 0 },
      { x: 120, y: 80 },
      { x: 160, y: 0 },
    ]);
    expect(editor.doc.list()[0]?.kind).toBe('path');
  });

  it('undo brings back the hand-drawn version first', () => {
    const editor = penEditor();
    draw(editor, circle(200, 200, 60));
    editor.undo();
    expect(editor.doc.list().map((el) => el.kind)).toEqual(['path']);
    editor.undo();
    expect(editor.doc.size).toBe(0);
  });

  it('turns a line between two shapes into a bound arrow', () => {
    const editor = penEditor();
    draw(editor, circle(100, 100, 50));
    draw(editor, circle(400, 100, 50));
    const [a, b] = takeTwo(shapes(editor.doc));
    draw(editor, line({ x: 160, y: 102 }, { x: 340, y: 98 }));
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow.start.shapeId).toBe(a.id);
    expect(arrow.end.shapeId).toBe(b.id);
  });

  it('straightens a free line and aligns a new shape with its neighbour', () => {
    const editor = penEditor();
    draw(editor, line({ x: 0, y: 300 }, { x: 200, y: 310 }));
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow.start.y).toBe(arrow.end.y);

    draw(editor, circle(100, 100, 50));
    draw(editor, circle(400, 106, 52));
    const [first, second] = takeTwo(shapes(editor.doc).filter((el) => el.kind === 'ellipse'));
    expect(second.y + second.h / 2).toBe(first.y + first.h / 2);
    expect(second.w).toBe(first.w);
  });
});
