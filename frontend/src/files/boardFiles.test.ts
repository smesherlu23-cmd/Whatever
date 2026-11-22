import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardFiles } from './boardFiles';

describe('BoardFiles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a picture in a new tab and downloads other files', () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const files = new BoardFiles('b1');
    files.open({ id: 'f1', name: 'схема.png', size: 10, type: 'image/png' });
    files.open({ id: 'f2', name: 'план.pdf', size: 10, type: 'application/octet-stream' });

    const [picture, attachment] = clicked;
    expect(picture?.getAttribute('href')).toBe('/api/boards/b1/files/f1');
    expect(picture?.target).toBe('_blank');
    expect(picture?.rel).toBe('noopener');
    expect(attachment?.getAttribute('href')).toBe('/api/boards/b1/files/f2');
    expect(attachment?.download).toBe('план.pdf');
  });
});
