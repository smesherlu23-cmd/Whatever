import type { Tool } from '../editor/Editor';
import styles from './Toolbar.module.css';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Выделение', key: 'V' },
  { id: 'rectangle', label: 'Прямоугольник', key: 'R' },
  { id: 'ellipse', label: 'Эллипс', key: 'O' },
  { id: 'diamond', label: 'Ромб', key: 'D' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
  { id: 'text', label: 'Текст', key: 'T' },
];

export function Toolbar({
  tool,
  onChange,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Инструменты">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={styles.button}
          aria-pressed={tool === t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
      <span className={styles.divider} />
      <button type="button" className={styles.button} title="Отменить (Ctrl+Z)" onClick={onUndo}>
        Отменить
      </button>
      <button type="button" className={styles.button} title="Повторить (Ctrl+Shift+Z)" onClick={onRedo}>
        Повторить
      </button>
    </div>
  );
}
