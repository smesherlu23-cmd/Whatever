import type { ShapePreset } from '../editor/Editor';
import type { CatalogKind } from '../model/shapes';

export interface LibraryItem {
  /** Уникален в библиотеке: одна фигура бывает в нескольких наборах под разными именами. */
  id: string;
  kind: CatalogKind;
  label: string;
  preset?: ShapePreset;
}

export interface LibraryGroup {
  title: string;
  items: readonly LibraryItem[];
}

const item = (kind: CatalogKind, label: string, preset?: ShapePreset, id: string = kind) => ({
  id,
  kind,
  label,
  ...(preset && { preset }),
});

/** Наборы фигур на панели «Фигуры». Одна фигура может входить в несколько наборов. */
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
  {
    title: 'UML',
    items: [
      item('class', 'Класс', { text: 'Класс\n--\n+ поле: Тип\n--\n+ метод(): Тип' }),
      item('class', 'Интерфейс', { text: '«интерфейс»\nИмя\n--\n+ метод(): Тип' }, 'interface'),
      item('component', 'Компонент'),
      item('package', 'Пакет'),
      item('actor', 'Актёр'),
      item('lifeline', 'Линия жизни', { text: 'Объект' }),
      item('note', 'Комментарий', undefined, 'uml-note'),
    ],
  },
  {
    title: 'ER',
    items: [
      item('entity', 'Сущность', { text: 'Сущность\n--\nid: uuid PK\nназвание: text' }),
      item('note', 'Примечание', undefined, 'er-note'),
    ],
  },
  {
    title: 'BPMN',
    items: [
      item('startEvent', 'Начальное событие'),
      item('rounded', 'Задача', undefined, 'task'),
      item('gateway', 'Шлюз'),
      item('endEvent', 'Конечное событие'),
    ],
  },
  {
    title: 'Контейнеры',
    items: [
      item('frame', 'Рамка', { text: 'Рамка' }),
      item('group', 'Граница системы', { text: 'Система' }),
      item('lane', 'Дорожка', { text: 'Участник' }),
    ],
  },
];
