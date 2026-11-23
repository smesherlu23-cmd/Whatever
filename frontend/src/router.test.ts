import { describe, expect, it } from 'vitest';
import { type BoardsView, boardPath, boardsPath, parseRoute } from './router';

const BOARD_ID = '0b7d2d4e-1c2a-4c49-9d6f-1f2e3d4c5b6a';
const THREAD_ID = '6f1c0e2a-9b3d-4e5f-8a7b-0c1d2e3f4a5b';
const TOKEN = 'h3Kq9-x_Vb2mN7pLr4sT1uWy';

describe('parseRoute', () => {
  it.each([
    ['/', { page: 'boards', view: 'mine', folderId: null }],
    [`/?folder=${BOARD_ID}`, { page: 'boards', view: 'mine', folderId: BOARD_ID }],
    ['/?folder=../etc', { page: 'boards', view: 'mine', folderId: null }],
    ['/?view=shared', { page: 'boards', view: 'shared' }],
    ['/?view=all', { page: 'boards', view: 'all' }],
    [`/b/${BOARD_ID}`, { page: 'board', boardId: BOARD_ID, threadId: null }],
    [`/b/${BOARD_ID}/`, { page: 'board', boardId: BOARD_ID, threadId: null }],
    [
      `/b/${BOARD_ID}?thread=${THREAD_ID}`,
      { page: 'board', boardId: BOARD_ID, threadId: THREAD_ID },
    ],
    [`/b/${BOARD_ID}?thread=1`, { page: 'board', boardId: BOARD_ID, threadId: null }],
    [`/s/${TOKEN}`, { page: 'join', token: TOKEN }],
    ['/s/short', { page: 'not-found' }],
    ['/account', { page: 'account' }],
    ['/admin/', { page: 'admin' }],
    ['/b/not-a-board', { page: 'not-found' }],
    ['/admins', { page: 'not-found' }],
  ])('reads %s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it.each<BoardsView>([
    { view: 'mine', folderId: null },
    { view: 'mine', folderId: BOARD_ID },
    { view: 'shared' },
    { view: 'all' },
  ])('builds the list address that it reads back: %o', (view) => {
    expect(parseRoute(boardsPath(view))).toEqual({ page: 'boards', ...view });
  });

  it.each([null, THREAD_ID])('builds the board address that it reads back: %s', (threadId) => {
    expect(parseRoute(boardPath(BOARD_ID, threadId))).toEqual({
      page: 'board',
      boardId: BOARD_ID,
      threadId,
    });
  });
});
