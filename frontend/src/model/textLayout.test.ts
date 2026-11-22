import { describe, expect, it } from 'vitest';
import { wrapText } from './textLayout';

describe('wrapText', () => {
  it('wraps words to the width and keeps line breaks', () => {
    const measure = (t: string) => t.length * 10;
    expect(wrapText(measure, 'один два три\nчетыре', 80)).toEqual(['один два', 'три', 'четыре']);
  });
});
