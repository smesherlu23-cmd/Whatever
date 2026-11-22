import { describe, expect, it } from 'vitest';
import type { Folder } from '../../api';
import { folderChoices, folderPath, subfolders } from './folders';

const folder = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent_id: parent,
  created_at: '2026-11-21T00:00:00Z',
});

const FOLDERS = [
  folder('b', 'Бэкенд', 'p'),
  folder('p', 'Проекты'),
  folder('a', 'Архив'),
  folder('f', 'Фронтенд', 'p'),
];

describe('folders', () => {
  it('finds the path from the root to a folder', () => {
    expect(folderPath(FOLDERS, 'b').map((f) => f.name)).toEqual(['Проекты', 'Бэкенд']);
    expect(folderPath(FOLDERS, null)).toEqual([]);
    expect(folderPath(FOLDERS, 'missing')).toEqual([]);
  });

  it('survives a cycle in broken data', () => {
    const cycle = [folder('x', 'X', 'y'), folder('y', 'Y', 'x')];
    expect(folderPath(cycle, 'x')).toHaveLength(2);
  });

  it('lists subfolders by name', () => {
    expect(subfolders(FOLDERS, null).map((f) => f.name)).toEqual(['Архив', 'Проекты']);
    expect(subfolders(FOLDERS, 'p').map((f) => f.name)).toEqual(['Бэкенд', 'Фронтенд']);
  });

  it('offers every folder with its full path in tree order', () => {
    expect(folderChoices(FOLDERS).map((c) => c.label)).toEqual([
      'Архив',
      'Проекты',
      'Проекты / Бэкенд',
      'Проекты / Фронтенд',
    ]);
  });
});
