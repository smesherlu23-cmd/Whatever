import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PICTURE_SIDE, prepareFile } from './prepare';

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

describe('prepareFile', () => {
  let toBlob: ReturnType<typeof vi.fn>;
  let drawImage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    toBlob = vi.fn((done: (blob: Blob | null) => void, type: string) => {
      done(new Blob(['small'], { type }));
    });
    HTMLCanvasElement.prototype.toBlob = toBlob as HTMLCanvasElement['toBlob'];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('attaches files that are not pictures as they are', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const file = new File(['%PDF'], 'отчёт.pdf', { type: 'application/pdf' });
    await expect(prepareFile(file)).resolves.toEqual({
      content: file,
      name: 'отчёт.pdf',
      picture: null,
    });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('keeps a picture that is small enough and reports its size', async () => {
    const decoded = bitmap(800, 600);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(decoded));
    const file = new File(['png'], 'схема.png', { type: 'image/png' });
    await expect(prepareFile(file)).resolves.toEqual({
      content: file,
      name: 'схема.png',
      picture: { width: 800, height: 600 },
    });
    expect(decoded.close).toHaveBeenCalled();
  });

  it('shrinks a large picture, and a GIF becomes a PNG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(4096, 1024)));
    const jpeg = await prepareFile(new File(['jpg'], 'фото.jpg', { type: 'image/jpeg' }));
    expect(jpeg.picture).toEqual({ width: MAX_PICTURE_SIDE, height: 512 });
    expect(jpeg.name).toBe('фото.jpg');
    expect(jpeg.content.type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, MAX_PICTURE_SIDE, 512);

    const gif = await prepareFile(new File(['gif'], 'анимация.gif', { type: 'image/gif' }));
    expect(gif.name).toBe('анимация.png');
    expect(gif.content.type).toBe('image/png');
  });

  it('attaches a picture the browser cannot open', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image')));
    const file = new File(['?'], 'битая.png', { type: 'image/png' });
    await expect(prepareFile(file)).resolves.toMatchObject({ content: file, picture: null });
  });

  it('fails when the browser cannot save the smaller copy', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap(5000, 5000)));
    toBlob.mockImplementation((done: (blob: Blob | null) => void) => {
      done(null);
    });
    const file = new File(['png'], 'огромная.png', { type: 'image/png' });
    await expect(prepareFile(file)).rejects.toThrow('не смог сохранить');

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(prepareFile(file)).rejects.toThrow('не дал нарисовать');
  });
});
