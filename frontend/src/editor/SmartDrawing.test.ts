import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '../model/types';
import { arrows, defined, shapes, takeTwo } from '../testing/helpers';
import { Editor, HOLD_MS } from './Editor';

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

function draw(editor: Editor, points: Point[], hold: boolean) {
  const [first, ...rest] = points;
  editor.pointerDown(defined(first));
  for (const p of rest) editor.pointerMove(p);
  if (hold) vi.advanceTimersByTime(HOLD_MS + 10);
  editor.pointerUp();
}

describe('smart drawing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a held circle into a neat circle', () => {
    const editor = new Editor();
    editor.setTool('pen');
    draw(editor, circle(200, 200, 60), true);
    const shape = defined(shapes(editor.doc)[0]);
    expect(shape.kind).toBe('ellipse');
    expect(shape.w).toBe(shape.h);
    expect(editor.tool).toBe('pen');
  });

  it('keeps the hand-drawn stroke when released without holding', () => {
    const editor = new Editor();
    editor.setTool('pen');
    draw(editor, circle(200, 200, 60), false);
    expect(editor.doc.list()[0]?.kind).toBe('path');
  });

  it('recognizes every stroke in "always" mode and never in "off" mode', () => {
    const editor = new Editor();
    editor.setTool('pen');
    editor.setSmartMode('always');
    draw(editor, circle(200, 200, 60), false);
    expect(editor.doc.list()[0]?.kind).toBe('ellipse');

    const plain = new Editor();
    plain.setTool('pen');
    plain.setSmartMode('off');
    draw(plain, circle(200, 200, 60), true);
    expect(plain.doc.list()[0]?.kind).toBe('path');
  });

  it('undo brings back the hand-drawn version first', () => {
    const editor = new Editor();
    editor.setTool('pen');
    draw(editor, circle(200, 200, 60), true);
    editor.undo();
    expect(editor.doc.list().map((el) => el.kind)).toEqual(['path']);
    editor.undo();
    expect(editor.doc.size).toBe(0);
  });

  it('turns a line between two shapes into a bound arrow', () => {
    const editor = new Editor();
    editor.setTool('pen');
    editor.setSmartMode('always');
    draw(editor, circle(100, 100, 50), false);
    draw(editor, circle(400, 100, 50), false);
    const [a, b] = takeTwo(shapes(editor.doc));
    draw(editor, line({ x: 160, y: 102 }, { x: 340, y: 98 }), false);
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow.start.shapeId).toBe(a.id);
    expect(arrow.end.shapeId).toBe(b.id);
  });

  it('straightens a free line and aligns a new shape with its neighbour', () => {
    const editor = new Editor();
    editor.setTool('pen');
    editor.setSmartMode('always');
    draw(editor, line({ x: 0, y: 300 }, { x: 200, y: 310 }), false);
    const arrow = defined(arrows(editor.doc)[0]);
    expect(arrow.start.y).toBe(arrow.end.y);

    draw(editor, circle(100, 100, 50), false);
    draw(editor, circle(400, 106, 52), false);
    const [first, second] = takeTwo(shapes(editor.doc).filter((el) => el.kind === 'ellipse'));
    expect(second.y + second.h / 2).toBe(first.y + first.h / 2);
    expect(second.w).toBe(first.w);
  });

  it('shows the recognized shape while the pointer is held', () => {
    const editor = new Editor();
    editor.setTool('pen');
    const [first, ...rest] = circle(200, 200, 60);
    editor.pointerDown(defined(first));
    for (const p of rest) editor.pointerMove(p);
    expect(editor.strokePreview).toBeNull();
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(editor.strokePreview?.kind).toBe('ellipse');
    editor.pointerMove({ x: 500, y: 500 });
    expect(editor.strokePreview).toBeNull();
    editor.pointerUp();
  });
});
