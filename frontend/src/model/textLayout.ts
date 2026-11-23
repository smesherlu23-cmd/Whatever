/**
 * Размеры текста в фигурах (в мировых единицах). Общие для холста и поля редактирования,
 * чтобы текст при вводе стоял ровно там же, где потом нарисуется.
 */
import type { Bounds, Point } from './types';

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 20;
export const TEXT_PADDING = 8;

/** Мелкий текст: секции класса и заголовки контейнеров. */
export const SMALL_FONT_SIZE = 14;
export const SMALL_LINE_HEIGHT = 18;
/** Поля секции класса сверху и снизу. */
export const SECTION_PADDING = 6;

/** Высота секции класса или сущности из rows строк. Пустая секция высотой в одну строку. */
export function sectionHeight(rows: number): number {
  return Math.max(rows, 1) * SMALL_LINE_HEIGHT + SECTION_PADDING * 2;
}

/** Подпись стрелки мельче текста фигур и не шире LABEL_MAX_WIDTH. */
export const LABEL_FONT_SIZE = 14;
export const LABEL_LINE_HEIGHT = 18;
export const LABEL_MAX_WIDTH = 200;
export const LABEL_PADDING = 4;

/** Средняя ширина символа в долях размера шрифта: для оценки ширины текста без холста. */
const AVERAGE_CHAR_WIDTH = 0.56;

export type Measure = (text: string) => number;

/**
 * Ширина текста без холста. Для попадания по подписи и для границ элемента хватает
 * оценки, а рисует подпись холст по точным размерам.
 */
export function estimateMeasure(fontSize: number): Measure {
  return (text) => text.length * fontSize * AVERAGE_CHAR_WIDTH;
}

/** Строки подписи стрелки и её рамка с полями вокруг точки anchor. */
export function labelLayout(
  text: string,
  anchor: Point,
  measure: Measure,
): { lines: string[]; box: Bounds } {
  const lines = wrapText(measure, text, LABEL_MAX_WIDTH);
  const w = Math.max(...lines.map(measure)) + LABEL_PADDING * 2;
  const h = lines.length * LABEL_LINE_HEIGHT + LABEL_PADDING * 2;
  return { lines, box: { x: anchor.x - w / 2, y: anchor.y - h / 2, w, h } };
}

/** Разбивает текст на строки не шире maxWidth. Переносы строк из текста сохраняются. */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}
