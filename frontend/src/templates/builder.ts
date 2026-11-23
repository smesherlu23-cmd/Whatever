import { BoardDocument } from '../model/document';
import { arrowPath, bindEnd, center } from '../model/geometry';
import { newId } from '../model/ids';
import { type ToolKind, compartmentsHeight, shapeSpec } from '../model/shapes';
import {
  type ArrowElement,
  type ArrowStyle,
  DEFAULT_ARROW_STYLE,
  DEFAULT_PAGE,
  DEFAULT_STROKE,
  type ShapeElement,
} from '../model/types';

/** Размер и заливка фигуры, если они не такие, как у фигуры, поставленной щелчком. */
export interface ShapeOptions {
  w?: number;
  h?: number;
  fill?: string;
}

export interface ArrowOptions extends Partial<ArrowStyle> {
  text?: string;
  /**
   * Высота, на которой стрелка соединяет линии жизни: так идут сообщения диаграммы
   * последовательности. К остальным фигурам стрелка цепляется краем.
   */
  y?: number;
}

/**
 * Собирает документ доски для встроенного шаблона. Фигуры получают размеры и заливку
 * из каталога, а стрелки привязываются к фигурам так же, как их привязывает редактор:
 * доска из шаблона ведёт себя как нарисованная вручную. Каждый следующий элемент
 * ложится поверх предыдущих, поэтому контейнеры добавляются раньше своего содержимого.
 */
export class TemplateBuilder {
  readonly board = new BoardDocument();
  private pageId = DEFAULT_PAGE;
  private paged = false;
  private z = 0;
  private readonly shapes = new Map<string, ShapeElement>();

  /**
   * Начинает страницу name. Первая страница — та, что есть у каждой доски: она только
   * получает название. Шаблон без страниц остаётся на одной безымянной странице.
   */
  page(name: string): void {
    if (this.paged) this.pageId = this.board.addPage(name);
    else this.board.renamePage(DEFAULT_PAGE, name);
    this.paged = true;
  }

  shape(kind: ToolKind, x: number, y: number, text = '', options: ShapeOptions = {}): ShapeElement {
    const spec = shapeSpec(kind);
    const shape: ShapeElement = {
      id: newId(),
      kind,
      page: this.pageId,
      x,
      y,
      w: options.w ?? spec.size.w,
      // Класс и сущность вырастают по своему тексту, чтобы были видны все поля.
      h: options.h ?? (spec.text === 'compartments' ? compartmentsHeight(text) : spec.size.h),
      text,
      stroke: DEFAULT_STROKE,
      fill: options.fill ?? spec.fill,
      z: this.nextZ(),
    };
    this.shapes.set(shape.id, shape);
    this.board.add(shape);
    return shape;
  }

  arrow(
    from: ShapeElement,
    to: ShapeElement,
    { text = '', y, ...style }: ArrowOptions = {},
  ): ArrowElement {
    const touch = (shape: ShapeElement) =>
      y === undefined ? center(shape) : { ...center(shape), y };
    const bound: ArrowElement = {
      id: newId(),
      kind: 'arrow',
      page: this.pageId,
      ...DEFAULT_ARROW_STYLE,
      ...style,
      start: bindEnd(from, touch(from)),
      end: bindEnd(to, touch(to)),
      text,
      stroke: DEFAULT_STROKE,
      z: this.nextZ(),
    };
    // Координаты концов — точки на краях фигур: если фигуру удалят, конец останется там же.
    const path = arrowPath(bound, (id) => this.shapes.get(id));
    const arrow: ArrowElement = {
      ...bound,
      start: { ...bound.start, ...path.start },
      end: { ...bound.end, ...path.end },
    };
    this.board.add(arrow);
    return arrow;
  }

  private nextZ(): number {
    this.z += 1;
    return this.z;
  }
}
