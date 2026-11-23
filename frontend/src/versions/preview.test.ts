import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { Editor } from '../editor/Editor';
import { BoardDocument } from '../model/document';
import { DEFAULT_FILL, DEFAULT_PAGE, DEFAULT_STROKE, type ShapeElement } from '../model/types';
import { defined } from '../testing/helpers';
import { version } from '../testing/versions';
import {
  MAX_VERSION_NAME,
  backupName,
  previewEditor,
  showSameView,
  versionPhrase,
  versionTitle,
} from './preview';

function box(id: string, page: string, x: number): ShapeElement {
  return {
    id,
    kind: 'rectangle',
    page,
    x,
    y: 0,
    w: 100,
    h: 100,
    text: '',
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    z: 1,
  };
}

/** Доска с двумя страницами и редактор, открытый на второй. */
function board() {
  const doc = new BoardDocument();
  doc.add(box('a', DEFAULT_PAGE, 0));
  const second = doc.addPage('Вторая');
  doc.add(box('b', second, 2000));
  const editor = new Editor(doc);
  editor.setViewport({ width: 800, height: 600 });
  editor.setPage(second);
  editor.setCamera({ x: -150, y: 40, zoom: 0.5 });
  return { editor, second, content: Y.encodeStateAsUpdate(doc.doc) };
}

describe('previewEditor', () => {
  it('opens the version read-only at the page and view of the board', () => {
    const { editor, second, content } = board();
    const preview = previewEditor(content, editor);
    expect(preview.readOnly).toBe(true);
    expect(preview.pageId).toBe(second);
    expect(preview.camera).toEqual(editor.camera);
    expect(preview.page.list().map((el) => el.id)).toEqual(['b']);
    // Версия — отдельный документ: доска от просмотра не меняется.
    expect(preview.doc).not.toBe(editor.doc);
  });

  it('shows the whole first page when the version has no such page', () => {
    const { editor } = board();
    const older = new BoardDocument();
    older.add(box('old', DEFAULT_PAGE, 5000));
    const preview = previewEditor(Y.encodeStateAsUpdate(older.doc), editor);
    expect(preview.pageId).toBe(DEFAULT_PAGE);
    const area = defined(preview.visibleArea());
    expect(area.x).toBeLessThan(5000);
    expect(area.x + area.w).toBeGreaterThan(5100);
  });

  it('fails on content that is not a board', () => {
    expect(() => previewEditor(new Uint8Array([1, 2, 3]), new Editor())).toThrow();
  });
});

describe('showSameView', () => {
  it('carries the page and the camera over when the page is there', () => {
    const { editor, second } = board();
    const other = new Editor(new BoardDocument());
    expect(showSameView(editor, other)).toBe(false);
    expect(other.pageId).toBe(DEFAULT_PAGE);

    const same = new Editor(editor.doc);
    expect(showSameView(editor, same)).toBe(true);
    expect(same.pageId).toBe(second);
    expect(same.camera).toEqual(editor.camera);
  });
});

describe('version names', () => {
  it('calls an automatic version by its time', () => {
    const auto = version('v1', '2026-11-23T07:05:00Z');
    expect(versionTitle(auto, () => 'сегодня в 10:05')).toBe('сегодня в 10:05');
    expect(versionTitle({ ...auto, name: 'Релиз' }, () => '')).toBe('Релиз');
  });

  it('names a version in a sentence by its name or by the full date', () => {
    const auto = version('v1', new Date(2026, 10, 23, 10, 5).toISOString());
    expect(versionPhrase(auto)).toBe('от 23 ноября 2026 г. в 10:05');
    expect(versionPhrase({ ...auto, name: 'Релиз' })).toBe('«Релиз»');
  });

  it('names the backup after the restored version, within the length the server takes', () => {
    const auto = version('v1', new Date(2026, 10, 23, 10, 5).toISOString());
    expect(backupName(auto)).toBe('Перед восстановлением версии от 23 ноября 2026 г. в 10:05');
    expect(backupName({ ...auto, name: 'Релиз 2.0' })).toBe(
      'Перед восстановлением версии «Релиз 2.0»',
    );
    const long = backupName({ ...auto, name: 'а'.repeat(MAX_VERSION_NAME) });
    expect(long).toHaveLength(MAX_VERSION_NAME);
    expect(long.endsWith('…»')).toBe(true);
  });
});
