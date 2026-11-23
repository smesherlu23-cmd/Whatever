import { type BoardVersion, api } from '../api';
import { Reloader } from '../collab/reloader';

export type VersionsStatus = 'loading' | 'ready' | 'failed';

export interface VersionsState {
  /** Версии доски, начиная с новых. */
  versions: readonly BoardVersion[];
  /** failed — не загрузились ни разу; если список уже был, при сбое остаётся прежний. */
  status: VersionsStatus;
}

/**
 * История версий открытой доски. Список нужен только панели истории: он читается, когда её
 * открывают (watch), и, пока она открыта, перечитывается целиком по сообщениям сервера
 * (см. Reloader). Свою правку пользователь видит сразу, по ответу сервера.
 */
export class VersionStore {
  private state: VersionsState = { versions: [], status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private readonly reloader: Reloader<BoardVersion[]>;
  private watchers = 0;

  constructor(private readonly boardId: string) {
    this.reloader = new Reloader(() => api.listVersions(boardId), {
      loaded: (versions) => {
        this.set({ versions, status: 'ready' });
      },
      failed: () => {
        if (this.state.status === 'loading') this.set({ ...this.state, status: 'failed' });
      },
    });
  }

  get snapshot(): VersionsState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Список нужен: он читается сейчас и потом после каждого изменения. Возвращает отписку. */
  watch(): () => void {
    this.watchers += 1;
    this.reloader.reload();
    return () => {
      this.watchers -= 1;
    };
  }

  /** Сервер сообщил, что версии изменились, или связь с ним восстановилась. */
  changed(): void {
    if (this.watchers > 0) this.reloader.reload();
  }

  /** Сохраняет версию с тем, что сейчас на доске. */
  async save(name: string): Promise<BoardVersion> {
    const version = await api.saveVersion(this.boardId, name);
    this.change([version, ...this.state.versions]);
    return version;
  }

  async rename(versionId: string, name: string): Promise<void> {
    const version = await api.renameVersion(versionId, name);
    this.change(this.state.versions.map((v) => (v.id === versionId ? version : v)));
  }

  async remove(versionId: string): Promise<void> {
    await api.deleteVersion(versionId);
    this.change(this.state.versions.filter((v) => v.id !== versionId));
  }

  /** Содержимое доски в версии. Оно не меняется, поэтому браузер берёт его из своего кэша. */
  content(versionId: string): Promise<Uint8Array> {
    return api.versionState(versionId);
  }

  private change(versions: readonly BoardVersion[]): void {
    this.reloader.edited();
    const complete = this.state.status === 'ready';
    this.set({ versions, status: 'ready' });
    // Список ещё не загружался: правка видна сразу, а остальное придёт следом.
    if (!complete) this.reloader.reload();
  }

  private set(state: VersionsState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
