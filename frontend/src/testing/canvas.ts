import { vi } from 'vitest';

/** Вызов подделки контекста: метод и его аргументы, а присваивание — «set свойство» и значение. */
export type Call = [method: string, ...args: unknown[]];

/**
 * Подделка 2D-контекста холста: в jsdom настоящего нет. Запоминает вызовы методов
 * и присваивания свойств; ширина текста — 8 единиц на символ.
 */
export function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'measureText'
          ? (text: string) => ({ width: text.length * 8 })
          : (...args: unknown[]) => calls.push([String(prop), ...args]),
      set: (_target, prop, value) => {
        calls.push([`set ${String(prop)}`, value]);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/**
 * Холст, на котором Board и мини-карта работают в jsdom: контекст, который ничего не рисует,
 * и ResizeObserver, которого в jsdom нет. Снимается vi.restoreAllMocks и vi.unstubAllGlobals.
 */
export function enableCanvas(): void {
  const blank = new Proxy({}, { get: () => () => ({ width: 0 }) }) as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(blank);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
}
