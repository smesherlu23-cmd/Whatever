/**
 * Перечитывание данных, которые хранятся на сервере, а не в документе доски. Сервер не
 * присылает сами изменения, а сообщает, что они были (session.ts), и данные читаются целиком:
 * так они совпадают с сервером, сколько бы сообщений ни потерялось без связи.
 *
 * Вызовы во время загрузки сливаются в одно повторное чтение. Свою правку пользователь видит
 * сразу, по ответу сервера, а ответ на чтение, начатое до неё, отбрасывается и данные читаются
 * снова: в том ответе правки ещё нет, и она бы мелькнула и пропала.
 */
export class Reloader<T> {
  private loading = false;
  private again = false;
  /** Растёт с каждой своей правкой: по нему видно, что ответ устарел. */
  private edits = 0;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly handlers: { loaded: (value: T) => void; failed: () => void },
  ) {}

  reload(): void {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    const edits = this.edits;
    this.load().then(
      (value) => {
        if (edits === this.edits) this.handlers.loaded(value);
        else this.again = true;
        this.done();
      },
      () => {
        this.handlers.failed();
        this.done();
      },
    );
  }

  /** Своя правка уже показана: ответы на чтения, начатые до неё, устарели. */
  edited(): void {
    this.edits += 1;
  }

  private done(): void {
    this.loading = false;
    if (!this.again) return;
    this.again = false;
    this.reload();
  }
}
