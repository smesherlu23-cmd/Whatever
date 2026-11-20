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
