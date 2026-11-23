import { ZOOM_STEP } from '../canvas/camera';
import type { Editor, Tool } from './Editor';

export interface KeyInput {
  key: string;
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
}

/**
 * Инструменты выбираются по физической клавише (KeyboardEvent.code),
 * поэтому сочетания работают и в русской раскладке.
 */
const TOOL_KEYS: Partial<Record<string, Tool>> = {
  KeyV: 'select',
  KeyP: 'pen',
  KeyR: 'rectangle',
  KeyU: 'rounded',
  KeyO: 'ellipse',
  KeyD: 'diamond',
  KeyY: 'triangle',
  KeyS: 'sticky',
  KeyA: 'arrow',
  KeyT: 'text',
  KeyC: 'comment',
};

/** Команды с Ctrl (⌘ на Mac). Ключ — латинская буква клавиши. */
const CTRL_COMMANDS: Partial<Record<string, (editor: Editor, shift: boolean) => void>> = {
  z: (editor, shift) => {
    if (shift) editor.redo();
    else editor.undo();
  },
  y: (editor) => editor.redo(),
  a: (editor) => editor.select(editor.page.list().map((el) => el.id)),
  d: (editor) => editor.duplicateSelection(),
  // Масштаб доски вместо масштаба страницы браузера.
  '=': (editor) => editor.zoomBy(ZOOM_STEP),
  '+': (editor) => editor.zoomBy(ZOOM_STEP),
  '-': (editor) => editor.zoomBy(1 / ZOOM_STEP),
};

/** Масштаб с Shift, по физической клавише цифры: Shift+1 в разных раскладках даёт разные знаки. */
const ZOOM_KEYS: Partial<Record<string, (editor: Editor) => void>> = {
  Digit0: (editor) => editor.resetZoom(),
  Digit1: (editor) => editor.zoomToFit(),
  Digit2: (editor) => {
    editor.zoomToSelection();
  },
};

/** Латинская буква клавиши: по коду, если он есть, иначе по введённому символу. */
function letterOf(input: KeyInput): string {
  const match = input.code ? /^Key([A-Z])$/.exec(input.code) : null;
  return (match?.[1] ?? input.key).toLowerCase();
}

/** Выполняет команду для нажатой клавиши. Возвращает true, если клавиша обработана. */
export function handleShortcut(editor: Editor, input: KeyInput): boolean {
  if (input.ctrl) {
    const command = CTRL_COMMANDS[letterOf(input)];
    command?.(editor, input.shift ?? false);
    return command !== undefined;
  }
  const zoom = input.shift && input.code ? ZOOM_KEYS[input.code] : undefined;
  if (zoom) {
    zoom(editor);
    return true;
  }
  switch (input.key.toLowerCase()) {
    case 'delete':
    case 'backspace':
      editor.deleteSelection();
      return true;
    case 'escape':
      editor.select([]);
      editor.setTool('select');
      return true;
    case 'enter':
      return editor.editSelectedText();
  }
  const tool = input.code ? TOOL_KEYS[input.code] : undefined;
  if (tool) editor.setTool(tool);
  return tool !== undefined;
}
