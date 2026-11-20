import type { SmartMode, Tool } from '../editor/Editor';
import styles from './Toolbar.module.css';

const TOOLS: readonly { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Выделение', key: 'V' },
  { id: 'pen', label: 'Умное рисование', key: 'P' },
  { id: 'rectangle', label: 'Прямоугольник', key: 'R' },
  { id: 'ellipse', label: 'Эллипс', key: 'O' },
  { id: 'diamond', label: 'Ромб', key: 'D' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
  { id: 'text', label: 'Текст', key: 'T' },
];

const SMART_MODES: readonly { mode: SmartMode; label: string }[] = [
  { mode: 'hold', label: 'Выравнивать при задержке' },
  { mode: 'always', label: 'Выравнивать всегда' },
  { mode: 'off', label: 'Не выравнивать' },
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
          onChange={(e) => {
            const selected = SMART_MODES.find(({ mode }) => mode === e.target.value);
            if (selected) onSmartModeChange(selected.mode);
          }}
        >
          {SMART_MODES.map(({ mode, label }) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      )}
      <span className={styles.divider} />
      <button type="button" className={styles.button} title="Отменить (Ctrl+Z)" onClick={onUndo}>
        Отменить
      </button>
      <button
        type="button"
        className={styles.button}
        title="Повторить (Ctrl+Shift+Z)"
        onClick={onRedo}
      >
        Повторить
      </button>
    </div>
  );
}
