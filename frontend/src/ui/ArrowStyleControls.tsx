import { useRef, useState } from 'react';
import { HEAD_NAMES } from '../canvas/arrowHeads';
import type { MixedArrowStyle } from '../editor/Editor';
import { ARROW_HEADS, type ArrowHead, type ArrowRoute, type ArrowStyle } from '../model/types';
import { HeadIcon } from './HeadIcon';
import styles from './Toolbar.module.css';
import { useDismiss } from './useDismiss';

const ROUTES: readonly { id: ArrowRoute; label: string }[] = [
  { id: 'straight', label: 'Прямая' },
  { id: 'elbow', label: 'Ломаная' },
];

const SIDES = {
  startHead: { side: 'start', label: 'Начало стрелки' },
  endHead: { side: 'end', label: 'Конец стрелки' },
} as const;

/**
 * Вид стрелки: линия, наконечники и пунктир. Если выделены стрелки, показывает и меняет
 * их вид; если у выделенных он разный, кнопка ничего не отмечает.
 */
export function ArrowStyleControls({
  style,
  selection,
  onChange,
}: {
  /** Вид новых стрелок. */
  style: ArrowStyle;
  /** Вид выделенных стрелок или null, если они не выделены. */
  selection: MixedArrowStyle | null;
  onChange: (patch: Partial<ArrowStyle>) => void;
}) {
  const shown: MixedArrowStyle = selection ?? style;
  return (
    <>
      <div className={styles.segmented} role="group" aria-label="Линия стрелки">
        {ROUTES.map((route) => (
          <button
            key={route.id}
            type="button"
            className={styles.segment}
            aria-pressed={shown.route === route.id}
            onClick={() => onChange({ route: route.id })}
          >
            {route.label}
          </button>
        ))}
      </div>
      {(['startHead', 'endHead'] as const).map((key) => (
        <HeadPicker
          key={key}
          side={SIDES[key].side}
          label={SIDES[key].label}
          value={shown[key]}
          onChange={(head) => onChange({ [key]: head })}
        />
      ))}
      <button
        type="button"
        className={styles.wideButton}
        aria-label="Пунктир"
        title="Пунктир: зависимость, асинхронный вызов, поток сообщений"
        aria-pressed={shown.dashed === true}
        onClick={() => onChange({ dashed: shown.dashed !== true })}
      >
        <HeadIcon head="none" side="end" dashed />
      </button>
    </>
  );
}

function HeadPicker({
  side,
  label,
  value,
  onChange,
}: {
  side: 'start' | 'end';
  label: string;
  value: ArrowHead | null;
  onChange: (head: ArrowHead) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => {
    setOpen(false);
  });
  return (
    <div className={styles.picker} ref={root}>
      <button
        type="button"
        className={styles.wideButton}
        aria-label={`${label}: ${value ? HEAD_NAMES[value] : 'разные'}`}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <HeadIcon head={value ?? 'none'} side={side} />
      </button>
      {open && (
        <div className={styles.popover} role="group" aria-label={label}>
          {ARROW_HEADS.map((head) => (
            <button
              key={head}
              type="button"
              className={styles.wideButton}
              aria-label={HEAD_NAMES[head]}
              title={HEAD_NAMES[head]}
              aria-pressed={value === head}
              onClick={() => {
                onChange(head);
                setOpen(false);
              }}
            >
              <HeadIcon head={head} side={side} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
