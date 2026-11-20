import { describe, expect, it } from 'vitest';
import { parseRoute } from './router';

const BOARD_ID = '0b7d2d4e-1c2a-4c49-9d6f-1f2e3d4c5b6a';

describe('parseRoute', () => {
  it.each([
    ['/', { page: 'boards' }],
    [`/b/${BOARD_ID}`, { page: 'board', boardId: BOARD_ID }],
    [`/b/${BOARD_ID}/`, { page: 'board', boardId: BOARD_ID }],
    ['/account', { page: 'account' }],
    ['/admin/', { page: 'admin' }],
    ['/b/not-a-board', { page: 'not-found' }],
    ['/admins', { page: 'not-found' }],
  ])('reads %s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });
});
