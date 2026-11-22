import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Awareness } from 'y-protocols/awareness';
import { Editor, type ViewportSize } from '../editor/Editor';
import { BoardDocument } from '../model/document';
import { defined, shapes } from '../testing/helpers';
import { participant, relay } from '../testing/peers';
import { Follow } from './follow';
import { syncPresence } from './syncPresence';

/** Участник с открытой доской в окне размера size, как в BoardSession. */
function session(name: string, size: ViewportSize) {
  const me = participant(name);
  const editor = new Editor(new BoardDocument(me.ydoc));
  editor.setViewport(size);
  const follow = new Follow(editor, me.presence);
  const stop = syncPresence(editor, me.presence, follow);
  return { ...me, editor, follow, stop };
}

/** Участники обмениваются присутствием несколько раз, как через сервер. */
function exchange(...all: { awareness: Awareness }[]): void {
  for (let round = 0; round < 5; round += 1) {
    vi.advanceTimersByTime(100);
    for (const from of all) for (const to of all) if (from !== to) relay(from, to);
  }
}

describe('syncPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes the page, the selection and the visible part of the board', () => {
    const bob = session('Борис', { width: 800, height: 600 });
    const alice = participant('Алиса');
    const seen = () => {
      exchange(bob, alice);
      return alice.presence.peers()[0];
    };
    expect(seen()).toMatchObject({ page: 'main', view: { x: 0, y: 0, w: 800, h: 600 } });

    bob.editor.setCamera({ x: -100, y: 0, zoom: 2 });
    expect(seen()?.view).toEqual({ x: 100, y: 0, w: 400, h: 300 });
    bob.editor.setViewport({ width: 400, height: 600 });
    expect(seen()?.view).toEqual({ x: 100, y: 0, w: 200, h: 300 });

    // У новой страницы своя камера, и вид после смены страницы публикуется заново.
    const page = bob.editor.doc.addPage('Контейнеры');
    bob.editor.setPage(page);
    expect(seen()).toMatchObject({ page, view: { x: 0, y: 0, w: 400, h: 600 } });

    bob.editor.setTool('rectangle');
    bob.editor.pointerDown({ x: 100, y: 100 });
    bob.editor.pointerUp();
    const shape = defined(shapes(bob.editor.doc)[0]);
    expect(seen()?.selection).toEqual([shape.id]);

    bob.stop();
    bob.editor.setCamera({ x: 0, y: 0, zoom: 4 });
    expect(seen()?.view).toEqual({ x: 0, y: 0, w: 400, h: 600 });
  });

  it('publishes the view of the participant being followed and its own view afterwards', () => {
    const alice = session('Алиса', { width: 800, height: 600 });
    const bob = session('Борис', { width: 1600, height: 600 });
    exchange(alice, bob);

    alice.follow.start(bob.id);
    exchange(alice, bob);
    expect(alice.editor.visibleArea()).toEqual({ x: 0, y: -300, w: 1600, h: 1200 });
    expect(bob.presence.peers()[0]?.view).toEqual({ x: 0, y: 0, w: 1600, h: 600 });

    alice.follow.stop();
    exchange(alice, bob);
    expect(bob.presence.peers()[0]?.view).toEqual({ x: 0, y: -300, w: 1600, h: 1200 });
  });

  it('does not zoom out step by step when two participants follow each other', () => {
    const alice = session('Алиса', { width: 800, height: 600 });
    const bob = session('Борис', { width: 1600, height: 600 });
    exchange(alice, bob);

    alice.follow.start(bob.id);
    exchange(alice, bob);
    bob.follow.start(alice.id);
    exchange(alice, bob);

    expect(alice.follow.leader?.name).toBe('Борис');
    expect(bob.follow.leader?.name).toBe('Алиса');
    expect(alice.editor.camera.zoom).toBe(0.5);
    expect(bob.editor.camera.zoom).toBe(1);
  });
});
