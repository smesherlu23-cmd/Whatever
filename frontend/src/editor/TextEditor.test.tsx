import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defined, shapes } from '../testing/helpers';
import { Editor } from './Editor';
import { TextEditor } from './TextEditor';

function editorWithEditedRectangle(): { editor: Editor; id: string } {
  const editor = new Editor();
  editor.setTool('rectangle');
  editor.pointerDown({ x: 0, y: 0 });
  editor.pointerUp();
  const id = defined(shapes(editor.doc)[0]).id;
  editor.startEditing(id);
  return { editor, id };
}

describe('TextEditor', () => {
  it('saves the text when the field loses focus', () => {
    const { editor, id } = editorWithEditedRectangle();
    render(<TextEditor editor={editor} id={id} />);
    const field = screen.getByRole('textbox', { name: 'Текст фигуры' });
    fireEvent.change(field, { target: { value: 'Сервис оплаты' } });
    fireEvent.blur(field);
    expect(editor.doc.get(id)).toMatchObject({ text: 'Сервис оплаты' });
    expect(editor.editingId).toBeNull();
  });

  it('finishes on Ctrl+Enter', () => {
    const { editor, id } = editorWithEditedRectangle();
    render(<TextEditor editor={editor} id={id} />);
    const field = screen.getByRole('textbox', { name: 'Текст фигуры' });
    fireEvent.change(field, { target: { value: 'API' } });
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(editor.doc.get(id)).toMatchObject({ text: 'API' });
  });
});

describe('TextEditor for an arrow label', () => {
  it('opens over the middle of the line and finishes on Enter', () => {
    const editor = new Editor();
    editor.setTool('arrow');
    editor.pointerDown({ x: 0, y: 100 });
    editor.pointerMove({ x: 300, y: 100 });
    editor.pointerUp();
    const id = defined(editor.page.list()[0]).id;
    editor.startEditing(id);
    render(<TextEditor editor={editor} id={id} />);

    const field = screen.getByRole('textbox', { name: 'Подпись стрелки' });
    // Подпись стоит по центру линии и закрывает её фоном холста.
    expect(field.style.left).toBe(`${150 - 100}px`);
    expect(field.style.background).toBe('var(--canvas-bg)');
    fireEvent.change(field, { target: { value: 'gRPC' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(editor.editingId).toBe(id);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editor.doc.get(id)).toMatchObject({ text: 'gRPC' });
    expect(editor.editingId).toBeNull();
  });
});

describe('TextEditor for shapes from the catalog', () => {
  function editing(kind: 'class' | 'lane' | 'frame') {
    const editor = new Editor();
    editor.setTool(kind);
    editor.pointerDown({ x: 400, y: 400 });
    editor.pointerUp();
    const id = defined(shapes(editor.doc)[0]).id;
    editor.startEditing(id);
    render(<TextEditor editor={editor} id={id} />);
    return { editor, id, field: screen.getByRole('textbox', { name: 'Текст фигуры' }) };
  }

  it('edits the compartments of a class from the top left', () => {
    const { field } = editing('class');
    expect(field.style.textAlign).toBe('left');
    expect(field.style.paddingTop).toBe('6px');
    // В классе Enter переносит строку: секций обычно несколько.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeNull();
  });

  it('edits a container title on one line', () => {
    const { editor, id, field } = editing('frame');
    fireEvent.change(field, { target: { value: 'Контур оплаты' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editor.doc.get(id)).toMatchObject({ text: 'Контур оплаты' });
  });

  it('turns the field of a lane title bottom to top', () => {
    const { field } = editing('lane');
    expect(field.style.transform).toBe('rotate(-90deg)');
    // До поворота ширина поля — высота дорожки.
    expect(field.style.width).toBe('180px');
  });
});
