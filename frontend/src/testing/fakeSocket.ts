/** WebSocket, которым управляет тест: открытие и закрытие происходят по команде. */
export class FakeSocket {
  static instances: FakeSocket[] = [];
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  }

  send(): void {
    // Сообщения серверу в тестах не проверяются.
  }

  close(): void {
    // Закрытие со стороны клиента y-websocket обрабатывает сам.
  }

  open(): void {
    this.onopen?.();
  }

  closeByServer(code: number): void {
    this.onclose?.({ code, reason: '' });
  }
}

/** Замена y-indexeddb для jsdom, где нет IndexedDB. Подключается через vi.mock. */
export const indexeddbStub = {
  IndexeddbPersistence: class {
    static cleared: string[] = [];

    constructor(readonly name: string) {}

    destroy(): Promise<void> {
      return Promise.resolve();
    }

    clearData(): Promise<void> {
      indexeddbStub.IndexeddbPersistence.cleared.push(this.name);
      return Promise.resolve();
    }
  },
};
