import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Editor } from '../editor/Editor';
import { BoardDocument } from '../model/document';
import { DEFAULT_PAGE } from '../model/types';
import { participant, relay } from '../testing/peers';
import { colorFor } from './colors';
import { Follow } from './follow';

/** Тот, кто следует: редактор с окном 800×600 и присутствие, связанное с остальными. */
function follower() {
  const me = participant('Борис');
  const editor = new Editor(new BoardDocument(me.ydoc));
  editor.setViewport({ width: 800, height: 600 });
  return { ...me, editor, follow: new Follow(editor, me.presence) };
}

/** Состояние from доходит до to. Курсор и вид уходят не сразу, поэтому сначала ждём их. */
function sync(from: { awareness: Awareness }, to: { awareness: Awareness }): void {
  vi.advanceTimersByTime(100);
  relay(from, to);
}

describe('Follow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the page of the participant and shows what they see', () => {
    const bob = follower();
    const alice = participant('Алиса');
    const page = bob.editor.doc.addPage('Контейнеры');
    alice.presence.setPage(page);
    alice.presence.setView({ x: 100, y: 50, w: 1600, h: 1200 });
    sync(alice, bob);

    bob.follow.start(alice.id);
    expect(bob.follow.leader).toEqual({
      clientId: alice.id,
      name: 'Алиса',
      color: colorFor(alice.id),
    });
    expect(bob.editor.pageId).toBe(page);
    expect(bob.editor.camera.zoom).toBe(0.5);
    expect(bob.editor.visibleArea()).toEqual({ x: 100, y: 50, w: 1600, h: 1200 });
    expect(bob.follow.view).toEqual({ x: 100, y: 50, w: 1600, h: 1200 });

    bob.follow.stop();
    expect(bob.follow.view).toBeNull();
  });

  it('keeps showing what the participant sees as they move', () => {
    const bob = follower();
    const alice = participant('Алиса');
    alice.presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    sync(alice, bob);
    bob.follow.start(alice.id);

    alice.presence.setView({ x: 400, y: 300, w: 400, h: 300 });
    sync(alice, bob);
    expect(bob.editor.visibleArea()).toEqual({ x: 400, y: 300, w: 400, h: 300 });

    const page = bob.editor.doc.addPage('Контейнеры');
    alice.presence.setPage(page);
    sync(alice, bob);
    expect(bob.editor.pageId).toBe(page);
    expect(bob.follow.leader).not.toBeNull();
  });

  it('fits the view into a window of another shape and refits it after a resize', () => {
    const bob = follower();
    const alice = participant('Алиса');
    alice.presence.setView({ x: 0, y: 0, w: 1000, h: 300 });
    sync(alice, bob);
    bob.follow.start(alice.id);
    // Видно всё, что у участника, по ширине окна, и больше по высоте.
    expect(bob.editor.visibleArea()).toEqual({ x: 0, y: -225, w: 1000, h: 750 });

    bob.editor.setViewport({ width: 400, height: 300 });
    expect(bob.follow.leader).not.toBeNull();
    expect(bob.editor.camera.zoom).toBe(0.4);
  });

  it('stops when the user moves the board or opens another page', () => {
    const bob = follower();
    const alice = participant('Алиса');
    alice.presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    sync(alice, bob);
    const changes = vi.fn();
    bob.follow.subscribe(changes);

    bob.follow.start(alice.id);
    bob.editor.wheel({ x: 10, y: 10 }, 0, 40, false);
    expect(bob.follow.leader).toBeNull();
    expect(changes).toHaveBeenCalledTimes(2);

    bob.follow.start(alice.id);
    bob.editor.setPage(bob.editor.doc.addPage('Контейнеры'));
    expect(bob.follow.leader).toBeNull();

    // Следование уже закончилось: новости участника камеру больше не двигают.
    const camera = bob.editor.camera;
    alice.presence.setView({ x: 500, y: 500, w: 800, h: 600 });
    sync(alice, bob);
    expect(bob.editor.camera).toBe(camera);
  });

  it('stops when the participant leaves the board', () => {
    const bob = follower();
    const alice = participant('Алиса');
    sync(alice, bob);
    bob.follow.start(alice.id);

    alice.awareness.setLocalState(null);
    sync(alice, bob);
    expect(bob.follow.leader).toBeNull();
  });

  it('switches between participants and stops on a second click', () => {
    const bob = follower();
    const alice = participant('Алиса');
    const carol = participant('Вера');
    sync(alice, bob);
    sync(carol, bob);

    bob.follow.toggle(alice.id);
    expect(bob.follow.leader?.name).toBe('Алиса');
    bob.follow.toggle(carol.id);
    expect(bob.follow.leader?.name).toBe('Вера');
    bob.follow.toggle(carol.id);
    expect(bob.follow.leader).toBeNull();

    bob.follow.start(12345);
    expect(bob.follow.leader).toBeNull();
    bob.follow.stop();
    expect(bob.follow.leader).toBeNull();
  });

  it('shows the new name of the participant', () => {
    const bob = follower();
    const alice = participant('Алиса');
    sync(alice, bob);
    bob.follow.start(alice.id);
    const before = bob.follow.leader;

    alice.presence.setUser('Алиса Петрова');
    sync(alice, bob);
    expect(bob.follow.leader?.name).toBe('Алиса Петрова');
    expect(bob.follow.leader).not.toBe(before);
  });

  it('waits for a page of the participant that has not arrived yet', () => {
    const bob = follower();
    const alice = participant('Алиса');
    const theirs = new BoardDocument(alice.ydoc);
    const page = theirs.addPage('Контейнеры');
    alice.presence.setPage(page);
    alice.presence.setView({ x: 400, y: 300, w: 800, h: 600 });
    sync(alice, bob);

    bob.follow.start(alice.id);
    expect(bob.editor.pageId).toBe(DEFAULT_PAGE);
    expect(bob.editor.camera.x).toBe(0);
    // Вид чужой страницы не выдаётся за вид этой.
    expect(bob.follow.view).toBeNull();

    Y.applyUpdate(bob.ydoc, Y.encodeStateAsUpdate(alice.ydoc));
    expect(bob.editor.pageId).toBe(page);
    expect(bob.editor.visibleArea()).toEqual({ x: 400, y: 300, w: 800, h: 600 });
    expect(bob.follow.leader).not.toBeNull();
  });
});
