import type { SmartMode, Tool } from '../editor/Editor';
import styles from './Toolbar.module.css';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Выделение', key: 'V' },
  { id: 'pen', label: 'Умное рисование', key: 'P' },
  { id: 'rectangle', label: 'Прямоугольник', key: 'R' },
  { id: 'ellipse', label: 'Эллипс', key: 'O' },
  { id: 'diamond', label: 'Ромб', key: 'D' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
  { id: 'text', label: 'Текст', key: 'T' },
];

export function Toolbar({
  tool,
  onChange,
  smartMode,
  onSmartModeChange,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onChange: (tool: Tool) => void;
  smartMode: SmartMode;
  onSmartModeChange: (mode: SmartMode) => void;
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
      {tool === 'pen' && (
        <select
          className={styles.select}
          aria-label="Когда выравнивать набросок"
          value={smartMode}
          onChange={(e) => onSmartModeChange(e.target.value as SmartMode)}
        >
          <option value="hold">Выравнивать при задержке</option>
          <option value="always">Выравнивать всегда</option>
          <option value="off">Не выравнивать</option>
        </select>
      )}
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
