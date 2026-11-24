import type { ShapePreset } from '../editor/Editor';
import type { ToolKind } from '../model/shapes';

export interface LibraryItem {
  /** Уникален в библиотеке: одна фигура бывает в нескольких наборах под разными именами. */
  id: string;
  kind: ToolKind;
  label: string;
  preset?: ShapePreset;
}

export interface LibraryGroup {
  title: string;
  items: readonly LibraryItem[];
}

const item = (kind: ToolKind, label: string, preset?: ShapePreset, id: string = kind) => ({
  id,
  kind,
  label,
  ...(preset && { preset }),
});

/**
 * Наборы фигур на панели «Фигуры». Одна фигура может входить в несколько наборов.
 * Остальные виды фигур каталога (UML, ER, BPMN, контейнеры) на панель не выводятся, но доски
 * и шаблоны, где они уже есть, показываются как прежде.
 */
export const SHAPE_LIBRARY: readonly LibraryGroup[] = [
  {
    title: 'Основные',
    items: [
      item('rectangle', 'Прямоугольник'),
      item('rounded', 'Скруглённый прямоугольник'),
      item('ellipse', 'Эллипс'),
      item('diamond', 'Ромб'),
      item('triangle', 'Треугольник'),
      item('sticky', 'Стикер'),
      item('text', 'Текст'),
      item('note', 'Заметка'),
    ],
  },
  {
    title: 'Блок-схема',
    items: [
      item('terminal', 'Начало или конец'),
      item('rectangle', 'Процесс', undefined, 'process'),
      item('diamond', 'Решение', undefined, 'decision'),
      item('data', 'Данные'),
      item('document', 'Документ'),
      item('subprocess', 'Подпроцесс'),
      item('hexagon', 'Подготовка'),
      item('database', 'Хранилище', undefined, 'storage'),
    ],
  },
  {
    title: 'Инфраструктура и C4',
    items: [
      item('person', 'Человек'),
      item('browser', 'Веб-приложение'),
      item('mobile', 'Мобильное приложение'),
      item('server', 'Сервер'),
      item('database', 'База данных'),
      item('queue', 'Очередь'),
      item('cloud', 'Облако'),
      item('rounded', 'Контейнер C4', { text: 'Сервис\n[Технология]' }, 'c4-container'),
    ],
  },
];
