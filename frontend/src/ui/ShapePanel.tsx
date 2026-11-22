import { useState } from 'react';
import type { ShapePreset, Tool } from '../editor/Editor';
import styles from './ShapePanel.module.css';
import { ShapeIcon } from './ShapeIcon';
import { SHAPE_LIBRARY } from './shapeLibrary';

/**
 * Панель «Фигуры»: наборы для блок-схем, инфраструктуры и C4, UML, ER, BPMN и контейнеры.
 * Выбранная фигура ставится на доску щелчком или протягиванием, как фигуры с панели
 * инструментов.
 */
export function ShapePanel({
  tool,
  onPick,
  onClose,
}: {
  tool: Tool;
  onPick: (tool: Tool, preset: ShapePreset | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const groups = SHAPE_LIBRARY.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className={styles.panel} aria-label="Фигуры">
      <header className={styles.header}>
        <input
          className={styles.search}
          type="search"
          placeholder="Найти фигуру"
          aria-label="Найти фигуру"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className={styles.close}
          aria-label="Закрыть фигуры"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className={styles.title}>{group.title}</h3>
            <div className={styles.grid}>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.item}
                  aria-label={item.label}
                  title={item.label}
                  aria-pressed={tool === item.kind && picked === item.id}
                  onClick={() => {
                    setPicked(item.id);
                    onPick(item.kind, item.preset ?? null);
                  }}
                >
                  <ShapeIcon kind={item.kind} />
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className={styles.empty}>Таких фигур нет</p>}
      </div>
    </aside>
  );
}
