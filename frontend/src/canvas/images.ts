/** Через столько миллисекунд картинку, которая не загрузилась, пробуют загрузить снова. */
export const IMAGE_RETRY_MS = 30_000;

interface Entry {
  image: HTMLImageElement;
  state: 'loading' | 'ready' | 'failed';
  /** Когда загрузка не удалась: например, не было связи. */
  failedAt: number;
  /** Загрузка закончилась, удачно или нет. */
  done: Promise<void>;
}

/**
 * Картинки файлов доски для холста. Картинка начинает загружаться, когда её впервые
 * просят нарисовать, и остаётся в памяти: файл с тем же id не меняется никогда.
 * Когда картинка готова, подписчики узнают, что кадр пора перерисовать.
 */
export class ImageCache {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly url: (fileId: string) => string) {}

  /** Картинка, готовая к отрисовке, или null, пока она загружается или не загрузилась. */
  readonly get = (fileId: string): HTMLImageElement | null => {
    const entry = this.entry(fileId);
    return entry.state === 'ready' ? entry.image : null;
  };

  /** Ждёт, пока картинки загрузятся. Те, что не загрузились, останутся заглушками. */
  async ready(fileIds: Iterable<string>): Promise<void> {
    await Promise.all(Array.from(fileIds, (id) => this.entry(id).done));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private entry(fileId: string): Entry {
    const known = this.entries.get(fileId);
    const retry = known?.state === 'failed' && Date.now() - known.failedAt >= IMAGE_RETRY_MS;
    if (known && !retry) return known;
    const image = new Image();
    image.decoding = 'async';
    image.src = this.url(fileId);
    const entry: Entry = { image, state: 'loading', failedAt: 0, done: Promise.resolve() };
    entry.done = image.decode().then(
      () => {
        entry.state = 'ready';
        for (const listener of this.listeners) listener();
      },
      () => {
        entry.state = 'failed';
        entry.failedAt = Date.now();
      },
    );
    this.entries.set(fileId, entry);
    return entry;
  }
}
