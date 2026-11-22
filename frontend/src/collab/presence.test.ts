import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { participant, relay } from '../testing/peers';
import { Presence } from './presence';

describe('Presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares name, cursor and selection with other participants', () => {
    const alice = participant('Алиса');
    const bob = participant('Борис');
    alice.presence.setSelection(['shape-1']);
    alice.presence.setCursor({ x: 10, y: 20 });
    relay(alice, bob);

    expect(bob.presence.peers()).toEqual([
      expect.objectContaining({ name: 'Алиса', cursor: { x: 10, y: 20 }, selection: ['shape-1'] }),
    ]);
    expect(alice.presence.peers()).toEqual([]);
  });

  it('shares the open page and forgets the cursor and view of the previous page', () => {
    const alice = participant('Алиса');
    const bob = participant('Борис');
    alice.presence.setCursor({ x: 10, y: 20 });
    alice.presence.setCursor({ x: 30, y: 40 });
    alice.presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    alice.presence.setSelection(['shape-1']);
    relay(alice, bob);
    expect(bob.presence.peers()[0]).toMatchObject({ page: 'main' });

    alice.presence.setPage('p2');
    alice.presence.setPage('p2');
    // Отложенные курсор и вид со старой страницы не должны догнать участника на новой.
    vi.advanceTimersByTime(100);
    relay(alice, bob);
    expect(bob.presence.peers()[0]).toMatchObject({
      page: 'p2',
      cursor: null,
      view: null,
      selection: [],
    });
  });

  it('sends the cursor and the visible part of the board in one throttled update', () => {
    const alice = participant('Алиса');
    const bob = participant('Борис');
    const updates = vi.fn();
    alice.awareness.on('update', updates);

    alice.presence.setCursor({ x: 1, y: 1 });
    alice.presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    alice.presence.setCursor({ x: 2, y: 2 });
    expect(updates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(updates).toHaveBeenCalledTimes(2);

    relay(alice, bob);
    expect(bob.presence.peers()[0]).toMatchObject({
      cursor: { x: 2, y: 2 },
      view: { x: 0, y: 0, w: 800, h: 600 },
    });
  });

  it('throttles cursor updates but keeps the last position', () => {
    const { awareness, presence } = participant('Алиса');
    const updates = vi.fn();
    awareness.on('update', updates);

    presence.setCursor({ x: 1, y: 1 });
    presence.setCursor({ x: 2, y: 2 });
    presence.setCursor({ x: 3, y: 3 });
    expect(updates).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60);
    expect(updates).toHaveBeenCalledTimes(2);
    expect(awareness.getLocalState()?.cursor).toEqual({ x: 3, y: 3 });
  });

  it('does not send the same view again', () => {
    const { awareness, presence } = participant('Алиса');
    const updates = vi.fn();
    awareness.on('update', updates);
    presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    vi.advanceTimersByTime(60);
    presence.setView({ x: 0, y: 0, w: 800, h: 600 });
    vi.advanceTimersByTime(60);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('republishes its state when attached to a new connection', () => {
    const alice = participant('Алиса');
    alice.presence.setSelection(['shape-1']);
    alice.detach();
    expect(alice.presence.peers()).toEqual([]);

    const reconnected = new Awareness(new Y.Doc());
    alice.presence.attach(reconnected);
    expect(reconnected.getLocalState()).toMatchObject({
      user: { name: 'Алиса' },
      selection: ['shape-1'],
    });
  });

  it('notifies subscribers when peers change', () => {
    const alice = participant('Алиса');
    const bob = participant('Борис');
    const listener = vi.fn();
    bob.presence.subscribe(listener);
    relay(alice, bob);
    expect(listener).toHaveBeenCalled();
  });
});

describe('Presence with broken data from another client', () => {
  it('ignores participants without a valid name and drops broken fields', () => {
    const awareness = new Awareness(new Y.Doc());
    const presence = new Presence(awareness.clientID, 'Алиса');
    presence.attach(awareness);
    const other = new Awareness(new Y.Doc());
    other.setLocalState({ user: { name: 42 } });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [other.clientID]), 'server');
    expect(presence.peers()).toEqual([]);

    other.setLocalState({
      user: { name: 'Борис', color: '#000' },
      cursor: 'x',
      view: { x: 0, y: 0, w: -800, h: 600 },
      selection: [1],
    });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [other.clientID]), 'server');
    expect(presence.peers()).toEqual([
      expect.objectContaining({ name: 'Борис', cursor: null, view: null, selection: [] }),
    ]);

    // Лишние поля вида от чужого клиента дальше не идут.
    other.setLocalState({
      user: { name: 'Борис', color: '#000' },
      view: { x: 0, y: 0, w: 800, h: 600, script: 'alert(1)' },
    });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [other.clientID]), 'server');
    expect(presence.peers()[0]?.view).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});
