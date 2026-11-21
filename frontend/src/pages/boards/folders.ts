import type { Folder } from '../../api';

/** Путь от корня до папки id включительно. Пустой, если такой папки нет. */
export function folderPath(folders: readonly Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  let current = id === null ? undefined : byId.get(id);
  // Сервер не допускает циклов, а ограничение длины защищает от испорченных данных.
  while (current && path.length < folders.length) {
    path.unshift(current);
    current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return path;
}

const byName = (a: Folder, b: Folder) => a.name.localeCompare(b.name, 'ru');

/** Вложенные папки parentId по алфавиту; null — папки верхнего уровня. */
export function subfolders(folders: readonly Folder[], parentId: string | null): Folder[] {
  return folders.filter((folder) => folder.parent_id === parentId).sort(byName);
}

export interface FolderChoice {
  id: string;
  /** Полный путь: «Проекты / Бэкенд». */
  label: string;
}

/** Все папки в порядке дерева с полными путями: для выбора, куда переложить доску. */
export function folderChoices(folders: readonly Folder[]): FolderChoice[] {
  const choices: FolderChoice[] = [];
  const visit = (parentId: string | null, prefix: string) => {
    for (const folder of subfolders(folders, parentId)) {
      const label = prefix + folder.name;
      choices.push({ id: folder.id, label });
      visit(folder.id, `${label} / `);
    }
  };
  visit(null, '');
  return choices;
}
