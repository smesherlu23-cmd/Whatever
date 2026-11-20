import { beforeEach, describe, expect, it } from 'vitest';
import { PEER_COLORS, colorFor, loadUserName, saveUserName } from './user';

describe('user', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('makes up a guest name once and then remembers it', () => {
    const first = loadUserName();
    expect(first).toMatch(/^Гость \d{4}$/);
    expect(loadUserName()).toBe(first);
    saveUserName('Роман');
    expect(loadUserName()).toBe('Роман');
  });

  it('gives every participant a colour from the palette', () => {
    expect(PEER_COLORS).toContain(colorFor(123456789));
    expect(colorFor(1)).not.toBe(colorFor(2));
  });
});
