/**
 * Размеры текста в фигурах (в мировых единицах). Общие для холста и поля редактирования,
 * чтобы текст при вводе стоял ровно там же, где потом нарисуется.
 */
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
