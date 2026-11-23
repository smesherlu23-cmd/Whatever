import { describe, expect, it } from 'vitest';
import { extension, fileSummary, formatSize } from './files';
import { fileId } from '../testing/helpers';

describe('file sizes and names', () => {
  it.each([
    [0, '0 Б'],
    [820, '820 Б'],
    [1536, '1,5 КБ'],
    [12 * 1024, '12 КБ'],
    [1.44 * 1024 * 1024, '1,4 МБ'],
    [3 * 1024 ** 4, '3 072 ГБ'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatSize(bytes).replace(/\s/g, ' ')).toBe(text);
  });

  it.each([
    ['отчёт.pdf', 'PDF'],
    ['архив.tar.gz', 'GZ'],
    ['.env', ''],
    ['README', ''],
    ['точка.', ''],
  ])('takes the extension of %s', (name, ext) => {
    expect(extension(name)).toBe(ext);
  });

  it('summarises a file for its card', () => {
    const file = { id: fileId(1), name: 'план.docx', size: 2048, type: 'application/octet-stream' };
    expect(fileSummary(file)).toBe('DOCX · 2 КБ');
    expect(fileSummary({ ...file, name: 'Makefile' })).toBe('2 КБ');
  });
});
