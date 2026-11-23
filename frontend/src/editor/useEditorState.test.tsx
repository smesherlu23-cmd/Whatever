import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor } from './Editor';
import { useEditorState } from './useEditorState';

describe('useEditorState', () => {
  it('follows the editor and skips changes the interface does not show', () => {
    const editor = new Editor();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useEditorState(editor);
    });
    expect(result.current.tool).toBe('select');

    act(() => editor.setTool('rectangle'));
    expect(result.current.tool).toBe('rectangle');
    const shown = renders;
    act(() => editor.pointerMove({ x: 10, y: 10 }, { shift: false }));
    expect(renders).toBe(shown);
  });

  it('shows the state of another editor in the same render', () => {
    const live = new Editor();
    const other = new Editor();
    other.setReadOnly(true);
    const { result, rerender } = renderHook(({ editor }) => useEditorState(editor), {
      initialProps: { editor: live },
    });
    expect(result.current.readOnly).toBe(false);

    rerender({ editor: other });
    expect(result.current.readOnly).toBe(true);
    // Прежний редактор больше не перерисовывает компонент.
    act(() => live.setTool('ellipse'));
    expect(result.current.tool).toBe('select');
    act(() => other.setTool('comment'));
    expect(result.current.tool).toBe('comment');
  });
});
