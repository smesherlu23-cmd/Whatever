import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../testing/helpers';
import { IMAGE_RETRY_MS, ImageCache } from './images';

/** Картинка-заглушка: decode завершается так, как решит тест. */
class FakeImage {
  static created: FakeImage[] = [];
  src = '';
  decoding = '';
  readonly settle = deferred<undefined>();
  constructor() {
    FakeImage.created.push(this);
  }
  decode(): Promise<undefined> {
    return this.settle.promise;
  }
}

const last = () => {
  const image = FakeImage.created.at(-1);
  if (!image) throw new Error('No image was created');
  return image;
};

describe('ImageCache', () => {
  beforeEach(() => {
    FakeImage.created = [];
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads an image once and tells subscribers when it is ready', async () => {
    const cache = new ImageCache((id) => `/files/${id}`);
    const redraw = vi.fn();
    cache.subscribe(redraw);

    expect(cache.get('a')).toBeNull();
    expect(cache.get('a')).toBeNull();
    expect(FakeImage.created).toHaveLength(1);
    expect(last().src).toBe('/files/a');

    const ready = cache.ready(['a']);
    last().settle.resolve(undefined);
    await ready;
    expect(redraw).toHaveBeenCalledTimes(1);
    expect(cache.get('a')).toBe(last());
  });

  it('keeps a placeholder for a broken image and retries it later', async () => {
    vi.useFakeTimers();
    const cache = new ImageCache((id) => `/files/${id}`);
    const unsubscribe = cache.subscribe(() => {
      throw new Error('A broken image must not trigger a redraw');
    });
    const ready = cache.ready(['b']);
    last().settle.reject(new Error('broken'));
    await ready;
    expect(cache.get('b')).toBeNull();
    expect(FakeImage.created).toHaveLength(1);

    unsubscribe();
    vi.advanceTimersByTime(IMAGE_RETRY_MS);
    expect(cache.get('b')).toBeNull();
    expect(FakeImage.created).toHaveLength(2);
  });
});
