import type { SelectionRoute, Tool } from '../editor/Editor';
import type { ArrowRoute } from '../model/types';
import { type IconName, ToolIcon } from './ToolIcon';
import styles from './Toolbar.module.css';

const TOOLS: readonly { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Выделение', key: 'V' },
  { id: 'pen', label: 'Рисование', key: 'P' },
  { id: 'rectangle', label: 'Прямоугольник', key: 'R' },
  { id: 'rounded', label: 'Скруглённый прямоугольник', key: 'U' },
  { id: 'ellipse', label: 'Эллипс', key: 'O' },
  { id: 'diamond', label: 'Ромб', key: 'D' },
  { id: 'triangle', label: 'Треугольник', key: 'Y' },
  { id: 'sticky', label: 'Стикер', key: 'S' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
  { id: 'text', label: 'Текст', key: 'T' },
];

const ROUTES: readonly { id: ArrowRoute; label: string }[] = [
  { id: 'straight', label: 'Прямая' },
  { id: 'elbow', label: 'Ломаная' },
];

function IconButton({
  icon,
  label,
  shortcut,
  pressed,
  onClick,
}: {
  icon: IconName;
  label: string;
  shortcut: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={label}
      aria-pressed={pressed}
      title={`${label} (${shortcut})`}
      onClick={onClick}
    >
      <ToolIcon name={icon} />
    </button>
  );
}

export function Toolbar({
  tool,
  onChange,
  smartDrawing,
  onSmartDrawingChange,
  arrowRoute,
  selectionRoute,
  onArrowRouteChange,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onChange: (tool: Tool) => void;
  smartDrawing: boolean;
  onSmartDrawingChange: (enabled: boolean) => void;
  /** Вид линии для новых стрелок. */
  arrowRoute: ArrowRoute;
  /** Вид линии выделенных стрелок; если они выделены, переключатель меняет их. */
  selectionRoute: SelectionRoute;
  onArrowRouteChange: (route: ArrowRoute) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const shownRoute = selectionRoute ?? arrowRoute;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Инструменты">
      {TOOLS.map((t) => (
        <IconButton
          key={t.id}
          icon={t.id}
          label={t.label}
          shortcut={t.key}
          pressed={tool === t.id}
          onClick={() => onChange(t.id)}
        />
      ))}
      {tool === 'pen' && (
        <label
          className={styles.switch}
          title="Набросок от руки превращается в ровную фигуру или стрелку"
        >
          <input
            type="checkbox"
            role="switch"
            checked={smartDrawing}
            onChange={(e) => onSmartDrawingChange(e.target.checked)}
          />
          Умное рисование
        </label>
      )}
      {(tool === 'arrow' || selectionRoute !== null) && (
        <div className={styles.segmented} role="group" aria-label="Линия стрелки">
          {ROUTES.map((route) => (
            <button
              key={route.id}
              type="button"
              className={styles.segment}
              aria-pressed={shownRoute === route.id}
              onClick={() => onArrowRouteChange(route.id)}
            >
              {route.label}
            </button>
          ))}
        </div>
      )}
      <span className={styles.divider} />
      <IconButton icon="undo" label="Отменить" shortcut="Ctrl+Z" onClick={onUndo} />
      <IconButton icon="redo" label="Повторить" shortcut="Ctrl+Shift+Z" onClick={onRedo} />
    </div>
  );
}
