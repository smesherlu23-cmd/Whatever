import type { MixedArrowStyle, Tool } from '../editor/Editor';
import type { ArrowStyle } from '../model/types';
import { ArrowStyleControls } from './ArrowStyleControls';
import { type IconName, ToolIcon } from './ToolIcon';
import styles from './Toolbar.module.css';

const TOOLS: readonly { id: Tool & IconName; label: string; key: string }[] = [
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
  arrowStyle,
  selectionArrowStyle,
  onArrowStyleChange,
  shapesOpen,
  onShapesToggle,
  onInsertFile,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onChange: (tool: Tool) => void;
  smartDrawing: boolean;
  onSmartDrawingChange: (enabled: boolean) => void;
  /** Вид новых стрелок. */
  arrowStyle: ArrowStyle;
  /** Вид выделенных стрелок; если они выделены, переключатели меняют их. */
  selectionArrowStyle: MixedArrowStyle | null;
  onArrowStyleChange: (patch: Partial<ArrowStyle>) => void;
  /** Открыта ли панель «Фигуры». */
  shapesOpen: boolean;
  onShapesToggle: () => void;
  /** Выбор картинки или файла с диска. */
  onInsertFile: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
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
      <button
        type="button"
        className={styles.button}
        aria-label="Фигуры"
        title="Фигуры: блок-схемы, инфраструктура, UML, ER, BPMN, контейнеры"
        aria-pressed={shapesOpen}
        onClick={onShapesToggle}
      >
        <ToolIcon name="shapes" />
      </button>
      <button
        type="button"
        className={styles.button}
        aria-label="Картинка или файл"
        title="Картинка или файл с диска. Их можно и перетащить на доску или вставить: Ctrl+V"
        onClick={onInsertFile}
      >
        <ToolIcon name="image" />
      </button>
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
      {(tool === 'arrow' || selectionArrowStyle !== null) && (
        <ArrowStyleControls
          style={arrowStyle}
          selection={selectionArrowStyle}
          onChange={onArrowStyleChange}
        />
      )}
      <span className={styles.divider} />
      <IconButton icon="undo" label="Отменить" shortcut="Ctrl+Z" onClick={onUndo} />
      <IconButton icon="redo" label="Повторить" shortcut="Ctrl+Shift+Z" onClick={onRedo} />
    </div>
  );
}
