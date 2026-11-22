import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Presence } from '../collab/presence';

/** Участник в отдельном браузере: свой документ, awareness и присутствие. */
export function participant(name: string) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const presence = new Presence(awareness.clientID, name);
  const detach = presence.attach(awareness);
  return { ydoc, awareness, presence, detach, id: awareness.clientID };
}

/** Передаёт состояние from участнику to — так, как это сделал бы сервер. */
export function relay(from: { awareness: Awareness }, to: { awareness: Awareness }): void {
  const update = encodeAwarenessUpdate(from.awareness, [from.awareness.clientID]);
  applyAwarenessUpdate(to.awareness, update, 'server');
}
