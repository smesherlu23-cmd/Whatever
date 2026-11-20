import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library убирает отрисованное само только при глобальных функциях vitest; здесь они выключены.
afterEach(() => {
  cleanup();
});

// В jsdom нет 2D-контекста холста. Board умеет работать без него, а отрисовку
// проверяют тесты render.test.ts на записывающей подделке контекста.
HTMLCanvasElement.prototype.getContext = () => null;
