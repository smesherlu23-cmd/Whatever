import styles from './Toolbar.module.css';

export type Tool = 'select' | 'pen' | 'rectangle' | 'ellipse' | 'arrow' | 'text';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Выделение', key: 'V' },
  { id: 'pen', label: 'Умное рисование', key: 'P' },
  { id: 'rectangle', label: 'Прямоугольник', key: 'R' },
  { id: 'ellipse', label: 'Эллипс', key: 'O' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
  { id: 'text', label: 'Текст', key: 'T' },
];

export function Toolbar({ tool, onChange }: { tool: Tool; onChange: (tool: Tool) => void }) {
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
    </div>
  );
}
