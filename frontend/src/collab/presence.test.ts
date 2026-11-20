import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Presence } from './presence';

/** Участник со своим документом и awareness, как в отдельной вкладке браузера. */
function participant(name: string) {
  const awareness = new Awareness(new Y.Doc());
  const presence = new Presence(awareness.clientID, name);
  const detach = presence.attach(awareness);
  return { awareness, presence, detach };
}

/** Передаёт состояние from в to — так, как это сделал бы сервер. */
function relay(from: Awareness, to: Awareness): void {
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'server');
}

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
    relay(alice.awareness, bob.awareness);

    expect(bob.presence.peers()).toEqual([
      expect.objectContaining({ name: 'Алиса', cursor: { x: 10, y: 20 }, selection: ['shape-1'] }),
    ]);
    expect(alice.presence.peers()).toEqual([]);
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
    relay(alice.awareness, bob.awareness);
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

    other.setLocalState({ user: { name: 'Борис', color: '#000' }, cursor: 'x', selection: [1] });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(other, [other.clientID]), 'server');
    expect(presence.peers()).toEqual([
      expect.objectContaining({ name: 'Борис', cursor: null, selection: [] }),
    ]);
  });
});
