import { describe, expect, it } from 'vitest';
import { PEER_COLORS, colorFor } from './colors';

describe('colors', () => {
  it('gives every participant a colour from the palette', () => {
    expect(PEER_COLORS).toContain(colorFor(123456789));
    expect(colorFor(1)).not.toBe(colorFor(2));
  });
});
