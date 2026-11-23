import type { ElementSource } from '../model/document';
import { TemplateBuilder } from './builder';
import { encodeBoard, previewPage } from './content';

/**
 * Встроенные шаблоны. Они собираются в браузере, а на сервер уходит готовое содержимое
 * новой доски, поэтому от сервера шаблоны не зависят и обновляются вместе с фронтендом.
 * Цвета у фигур обычные: они подстраиваются под тёмную тему, как у нарисованных вручную.
 */
export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  build(t: TemplateBuilder): void;
}

function c4(t: TemplateBuilder): void {
  t.page('Контекст');
  const buyer = t.shape('person', 305, 0, 'Покупатель');
  const shop = t.shape('rectangle', 250, 260, 'Интернет-магазин\nВыбор товаров и заказы', {
    w: 240,
    h: 120,
  });
  const payments = t.shape('rectangle', 250, 520, 'Платёжный сервис\nвнешняя система', {
    w: 240,
    h: 110,
  });
  const mail = t.shape('rectangle', 680, 265, 'Почтовый сервис\nвнешняя система', {
    w: 240,
    h: 110,
  });
  t.arrow(buyer, shop, { text: 'Оформляет заказы' });
  t.arrow(shop, payments, { text: 'Проводит оплату' });
  t.arrow(shop, mail, { text: 'Отправляет письма' });
  t.arrow(mail, buyer, { text: 'Письма о заказе' });

  t.page('Контейнеры');
  const customer = t.shape('person', 115, 0, 'Покупатель');
  // Граница системы ниже подписи стрелки от покупателя, чтобы подпись не легла на заголовок.
  t.shape('group', 0, 260, 'Интернет-магазин', { w: 860, h: 540 });
  const web = t.shape('browser', 80, 340, 'Веб-приложение\nReact');
  const api = t.shape('rectangle', 400, 355, 'API\nPython, FastAPI', { h: 100 });
  const db = t.shape('database', 680, 350, 'База данных\nPostgreSQL');
  const queue = t.shape('queue', 395, 515, 'Очередь задач');
  const worker = t.shape('rectangle', 390, 650, 'Обработчик заказов\nPython', { w: 180, h: 90 });
  const gateway = t.shape('rectangle', 940, 650, 'Платёжный сервис\nвнешняя система', {
    w: 220,
    h: 90,
  });
  t.arrow(customer, web, { text: 'Оформляет заказы' });
  t.arrow(web, api, { text: 'JSON/HTTPS' });
  t.arrow(api, db, { text: 'SQL' });
  t.arrow(api, queue, { text: 'Ставит задачи' });
  t.arrow(worker, queue, { text: 'Берёт задачи' });
  t.arrow(worker, gateway, { text: 'Проводит оплату' });
}

function flowchart(t: TemplateBuilder): void {
  const start = t.shape('terminal', 200, 0, 'Начало');
  const receive = t.shape('rectangle', 200, 120, 'Получить заявку');
  const check = t.shape('diamond', 190, 260, 'Данные заявки верны?', { w: 180, h: 120 });
  const rework = t.shape('rectangle', 480, 280, 'Вернуть на доработку');
  const run = t.shape('rectangle', 200, 450, 'Выполнить заявку');
  const report = t.shape('document', 200, 590, 'Отчёт о выполнении');
  const end = t.shape('terminal', 200, 740, 'Конец');
  t.arrow(start, receive);
  t.arrow(receive, check);
  t.arrow(check, run, { text: 'Да' });
  t.arrow(check, rework, { text: 'Нет' });
  t.arrow(rework, receive, { text: 'Исправлена' });
  t.arrow(run, report);
  t.arrow(report, end);
}

function dataModel(t: TemplateBuilder): void {
  const entity = (x: number, y: number, name: string, fields: string[]) =>
    t.shape('entity', x, y, [name, '--', ...fields].join('\n'), { w: 230 });
  const customer = entity(0, 0, 'Покупатель', [
    'id: uuid',
    'name: text',
    'email: text',
    'created_at: timestamptz',
  ]);
  const order = entity(380, 0, 'Заказ', [
    'id: uuid',
    'customer_id: uuid',
    'status: text',
    'total: numeric',
    'created_at: timestamptz',
  ]);
  const item = entity(380, 300, 'Позиция заказа', [
    'order_id: uuid',
    'product_id: uuid',
    'quantity: integer',
    'price: numeric',
  ]);
  const product = entity(760, 300, 'Товар', [
    'id: uuid',
    'title: text',
    'price: numeric',
    'stock: integer',
  ]);
  // Ломаные выпрямляются, когда таблицы стоят почти на одной линии.
  const relation = { route: 'elbow', startHead: 'one' } as const;
  t.arrow(customer, order, { ...relation, endHead: 'zeroOrMany', text: 'оформляет' });
  t.arrow(order, item, { ...relation, endHead: 'many', text: 'состоит из' });
  t.arrow(product, item, { ...relation, endHead: 'zeroOrMany', text: 'входит в' });
}

function sequence(t: TemplateBuilder): void {
  const lifeline = (x: number, name: string) => t.shape('lifeline', x, 0, name, { w: 160, h: 460 });
  const user = lifeline(0, 'Пользователь');
  const web = lifeline(240, 'Веб-приложение');
  const api = lifeline(480, 'API');
  const db = lifeline(720, 'База данных');
  const reply = { dashed: true, endHead: 'open' } as const;
  t.arrow(user, web, { y: 100, text: 'Нажимает «Оплатить»' });
  t.arrow(web, api, { y: 160, text: 'POST /orders' });
  t.arrow(api, db, { y: 220, text: 'Сохраняет заказ' });
  t.arrow(db, api, { ...reply, y: 280, text: 'id заказа' });
  t.arrow(api, web, { ...reply, y: 340, text: '201 Created' });
  t.arrow(web, user, { ...reply, y: 400, text: 'Номер заказа' });
}

function deployment(t: TemplateBuilder): void {
  const browser = t.shape('browser', 0, 185, 'Браузер сотрудника');
  t.shape('group', 280, 0, 'Сервер приложения, Docker', { w: 740, h: 500 });
  const proxy = t.shape('server', 330, 195, 'nginx');
  const frontend = t.shape('rectangle', 580, 60, 'Веб-интерфейс\nстатические файлы', { w: 190 });
  const backend = t.shape('rectangle', 580, 210, 'API и синхронизация\nFastAPI', { w: 190 });
  const db = t.shape('database', 860, 195, 'PostgreSQL');
  const files = t.shape('package', 585, 360, 'Файлы досок\nтом Docker', { h: 110 });
  t.arrow(browser, proxy, { text: 'HTTPS' });
  t.arrow(proxy, frontend, { text: 'страницы' });
  t.arrow(proxy, backend, { text: '/api, /ws' });
  t.arrow(backend, db, { text: 'SQL' });
  t.arrow(backend, files, { text: 'файлы' });
}

function retrospective(t: TemplateBuilder): void {
  const columns = [
    { title: 'Что прошло хорошо', notes: ['Быстро починили сборку', 'Демо прошло без сбоев'] },
    { title: 'Что мешало', notes: ['Долго ждали ревью', 'Требования менялись по ходу'] },
    {
      title: 'Что сделаем',
      notes: ['Ревью в течение дня', 'Уточнять требования до начала работы'],
    },
  ];
  columns.forEach(({ title, notes }, column) => {
    const x = column * 440;
    t.shape('frame', x, 0, title, { w: 400, h: 440 });
    notes.forEach((note, i) => t.shape('sticky', x + 24 + i * 192, 56, note));
  });
}

function riskMap(t: TemplateBuilder): void {
  // По горизонтали вероятность, по вертикали влияние: справа вверху — самое опасное.
  const cells = [
    {
      x: 160,
      y: 0,
      title: 'Следить и держать план Б',
      note: 'Отказ платёжного сервиса в распродажу',
    },
    { x: 600, y: 0, title: 'Действовать сразу', note: 'Ключевой разработчик уходит перед релизом' },
    { x: 160, y: 340, title: 'Принять', note: null },
    { x: 600, y: 340, title: 'Снижать, когда есть время', note: 'Медленная сборка фронтенда' },
  ];
  for (const { x, y, title, note } of cells) {
    t.shape('frame', x, y, title, { w: 420, h: 300 });
    if (note) t.shape('sticky', x + 24, y + 56, note);
  }
  t.shape('text', -10, 130, 'Высокое влияние', { w: 160 });
  t.shape('text', -10, 470, 'Низкое влияние', { w: 160 });
  t.shape('text', 270, 660, 'Низкая вероятность', { w: 200 });
  t.shape('text', 710, 660, 'Высокая вероятность', { w: 200 });
}

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    id: 'c4',
    name: 'Архитектура C4',
    description: 'Контекст системы и её контейнеры на двух страницах.',
    build: c4,
  },
  {
    id: 'flowchart',
    name: 'Блок-схема процесса',
    description: 'Шаги процесса, проверка условия и ветки «да» и «нет».',
    build: flowchart,
  },
  {
    id: 'data-model',
    name: 'Модель данных',
    description: 'Таблицы с полями и связи в нотации «воронья лапка».',
    build: dataModel,
  },
  {
    id: 'sequence',
    name: 'Диаграмма последовательности',
    description: 'Участники обмена и сообщения между ними по порядку.',
    build: sequence,
  },
  {
    id: 'deployment',
    name: 'Схема развёртывания',
    description: 'Сервер, контейнеры, база данных и хранилище файлов.',
    build: deployment,
  },
  {
    id: 'retrospective',
    name: 'Ретроспектива',
    description: 'Что прошло хорошо, что мешало и что сделаем дальше.',
    build: retrospective,
  },
  {
    id: 'risk-map',
    name: 'Карта рисков',
    description: 'Риски по вероятности и влиянию: с чего начинать.',
    build: riskMap,
  },
];

const built = new Map<string, TemplateBuilder>();

function builderOf(template: BuiltinTemplate): TemplateBuilder {
  let builder = built.get(template.id);
  if (!builder) {
    builder = new TemplateBuilder();
    template.build(builder);
    built.set(template.id, builder);
  }
  return builder;
}

/** Первая страница шаблона для превью. Шаблон собирается при первом обращении. */
export function builtinPreview(template: BuiltinTemplate): ElementSource {
  return previewPage(builderOf(template).board);
}

/** Содержимое новой доски по шаблону. */
export function builtinContent(template: BuiltinTemplate): string {
  return encodeBoard(builderOf(template).board);
}
