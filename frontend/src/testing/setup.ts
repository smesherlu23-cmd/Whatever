import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library убирает отрисованное само только при глобальных функциях vitest; здесь они выключены.
afterEach(() => {
  cleanup();
});

// В jsdom нет 2D-контекста холста. Board умеет работать без него, а отрисовку
// проверяют тесты render.test.ts на записывающей подделке контекста.
HTMLCanvasElement.prototype.getContext = () => null;

// В jsdom у <dialog> нет showModal и close. Здесь их поведение для тестов: окно открывается,
// а закрытие, как в браузере, присылает событие close.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

// В jsdom нет IntersectionObserver. Здесь всё, за чем следят, сразу видно на экране.
class VisibleObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
      time: 0,
    };
    this.callback([entry], this);
  }

  unobserve(): void {
    // Сообщения приходят только при observe: отписываться не от чего.
  }

  disconnect(): void {
    // То же, что unobserve.
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
window.IntersectionObserver = VisibleObserver;
