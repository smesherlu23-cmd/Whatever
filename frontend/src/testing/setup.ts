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
