/**
 * Размеры текста в фигурах (в мировых единицах). Общие для холста и поля редактирования,
 * чтобы текст при вводе стоял ровно там же, где потом нарисуется.
 */
import type { Bounds, ShapeElement } from '../model/types';

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 20;
export const TEXT_PADDING = 8;

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

/**
 * Область фигуры, по центру которой стоит текст. У треугольника это нижняя половина:
 * у вершины для текста нет места.
 */
export function textBox(el: ShapeElement): Bounds {
  if (el.kind === 'triangle')
    return { x: el.x + el.w / 4, y: el.y + el.h / 2, w: el.w / 2, h: el.h / 2 };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}
