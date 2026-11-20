import { beforeEach, describe, expect, it } from 'vitest';
import { MEMBER } from '../testing/auth';
import { forgetUser, rememberUser, rememberedUser } from './rememberedUser';

describe('rememberedUser', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers the user until they are forgotten', () => {
    expect(rememberedUser()).toBeNull();
    rememberUser(MEMBER);
    expect(rememberedUser()).toEqual(MEMBER);
    forgetUser();
    expect(rememberedUser()).toBeNull();
  });

  it.each([
    ['broken JSON', '{"id":'],
    ['not an object', '"ivan"'],
    ['unknown role', JSON.stringify({ ...MEMBER, role: 'owner' })],
    ['missing field', JSON.stringify({ ...MEMBER, name: undefined })],
    ['wrong type', JSON.stringify({ ...MEMBER, is_active: 'yes' })],
  ])('ignores %s', (_case, saved) => {
    localStorage.setItem('whatever-user', saved);
    expect(rememberedUser()).toBeNull();
  });
});
