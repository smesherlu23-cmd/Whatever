import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Follow } from '../../collab/follow';
import { Editor } from '../../editor/Editor';
import { BoardDocument } from '../../model/document';
import { participant, relay } from '../../testing/peers';
import { Participants } from './Participants';

/** Доска, открытая у Бориса, и участники, которые на неё зашли. */
function board(...names: string[]) {
  const me = participant('Борис');
  const editor = new Editor(new BoardDocument(me.ydoc));
  const follow = new Follow(editor, me.presence);
  const others = names.map((name) => participant(name));
  act(() => {
    for (const other of others) relay(other, me);
  });
  return { me, editor, follow, others };
}

const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed');

describe('Participants', () => {
  it('shows nothing while nobody else is on the board', () => {
    const { me, editor, follow } = board();
    const { container } = render(
      <Participants editor={editor} presence={me.presence} follow={follow} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows where everyone is and follows the participant that was clicked', () => {
    const { me, editor, follow, others } = board('Алиса', 'Вера');
    const page = editor.doc.addPage('Контейнеры');
    const vera = others[1];
    act(() => {
      vera?.presence.setPage(page);
      if (vera) relay(vera, me);
    });
    render(<Participants editor={editor} presence={me.presence} follow={follow} />);

    const alice = screen.getByRole('button', { name: 'Следовать за участником: Алиса' });
    expect(alice.textContent).toBe('А');
    expect(
      screen
        .getByRole('button', { name: 'Следовать за участником: Вера · страница «Контейнеры»' })
        .hasAttribute('data-away'),
    ).toBe(true);

    fireEvent.click(alice);
    expect(follow.leader?.name).toBe('Алиса');
    expect(pressed(alice)).toBe('true');
    expect(alice.title).toBe('Алиса. Щелчок — перестать следовать');

    fireEvent.click(alice);
    expect(follow.leader).toBeNull();
    expect(pressed(alice)).toBe('false');
  });

  it('puts participants who do not fit into a list', () => {
    const names = ['Алиса', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Зоя'];
    const { me, editor, follow } = board(...names);
    render(<Participants editor={editor} presence={me.presence} follow={follow} />);
    expect(screen.getAllByRole('button', { name: /^Следовать за участником/ })).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Все участники, ещё 3' }));
    const list = screen.getByRole('list', { name: 'Все участники' });
    expect(list.textContent).toBe(names.join(''));

    fireEvent.click(screen.getByRole('button', { name: 'Зоя' }));
    expect(follow.leader?.name).toBe('Зоя');
    expect(screen.queryByRole('list', { name: 'Все участники' })).toBeNull();
  });

  it('updates the list when someone leaves', () => {
    const { me, editor, follow, others } = board('Алиса', 'Вера');
    render(<Participants editor={editor} presence={me.presence} follow={follow} />);
    act(() => {
      const alice = others[0];
      alice?.awareness.setLocalState(null);
      if (alice) relay(alice, me);
    });
    expect(screen.queryByRole('button', { name: 'Следовать за участником: Алиса' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Следовать за участником: Вера' })).toBeDefined();
  });
});
