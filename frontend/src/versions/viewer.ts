import { type BoardVersion, errorText } from '../api';
import type { Follow } from '../collab/follow';
import type { Editor } from '../editor/Editor';
import { backupName, previewEditor, showSameView } from './preview';
import type { VersionStore } from './store';

export interface VersionPreview {
  version: BoardVersion;
  /** Редактор версии: только для чтения и со своим документом. */
  editor: Editor;
}

export interface ViewerMessage {
  text: string;
  error: boolean;
}

export interface ViewerState {
  /** Версия, которую видно вместо доски; null — видна сама доска. */
  preview: VersionPreview | null;
  /** id версии, которая открывается. */
  opening: string | null;
  restoring: boolean;
  /** Чем кончилось последнее действие: ошибка или сообщение о восстановлении. */
  message: ViewerMessage | null;
}

const NOTHING_SHOWN: ViewerState = {
  preview: null,
  opening: null,
  restoring: false,
  message: null,
};

const OPEN_FAILED = 'Не удалось открыть версию. Проверьте связь с сервером.';
const RESTORE_FAILED = 'Не удалось восстановить версию. Проверьте связь с сервером.';
const READ_ONLY = 'Доску сейчас нельзя менять, поэтому версию не восстановить.';

/**
 * Просмотр версий доски и восстановление одной из них. Версия показывается вместо доски
 * в отдельном редакторе только для чтения; сама доска в это время живёт как обычно.
 */
export class VersionViewer {
  private state: ViewerState = NOTHING_SHOWN;
  private readonly listeners = new Set<() => void>();
  /** Растёт с каждым переходом: по нему видно, что открытая версия уже не нужна. */
  private request = 0;

  constructor(
    private readonly store: VersionStore,
    private readonly live: Editor,
    private readonly follow: Follow,
  ) {}

  get snapshot(): ViewerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Пока работает: если начали следовать за участником, видна снова доска. Возвращает отключение. */
  start(): () => void {
    return this.follow.subscribe(() => {
      if (this.follow.leader && this.state.preview) this.leave(this.state);
    });
  }

  /** Показывает версию вместо доски, на той же странице и в том же месте. */
  show(version: BoardVersion): void {
    const { preview, opening, restoring } = this.state;
    if (restoring || opening === version.id || preview?.version.id === version.id) return;
    const request = ++this.request;
    // Вид доски больше не на экране: двигать его вслед за участником незачем.
    this.follow.stop();
    this.set({ ...this.state, opening: version.id, message: null });
    this.store.content(version.id).then(
      (content) => {
        if (request !== this.request) return;
        let editor: Editor;
        try {
          editor = previewEditor(content, this.state.preview?.editor ?? this.live);
        } catch {
          this.failed(OPEN_FAILED);
          return;
        }
        this.set({ ...this.state, preview: { version, editor }, opening: null });
      },
      (error: unknown) => {
        if (request === this.request) this.failed(errorText(error, OPEN_FAILED));
      },
    );
  }

  /** Снова показывает доску: ту же страницу и то же место, что смотрели в версии. */
  showCurrent(): void {
    const { preview } = this.state;
    if (preview) showSameView(preview.editor, this.live);
    this.leave({ ...this.state, message: null });
  }

  /**
   * Начинает заново: без открытой версии и сообщений. Так историю открывают всякий раз с доски,
   * даже если в прошлый раз панель закрылась сама, например когда открыли обсуждения.
   */
  reset(): void {
    this.request += 1;
    this.set(NOTHING_SHOWN);
  }

  /** Удаляет версию. Если её и смотрели, видна снова доска. */
  async remove(versionId: string): Promise<void> {
    await this.store.remove(versionId);
    if (this.state.preview?.version.id === versionId) this.showCurrent();
  }

  /**
   * Делает доску такой, как в показанной версии. Сначала то, что сейчас на доске, сохраняется
   * названной версией: к нему можно вернуться и тогда, когда Ctrl+Z уже не поможет.
   */
  async restore(): Promise<void> {
    const { preview } = this.state;
    if (!preview || this.state.restoring) return;
    if (this.live.readOnly) {
      this.failed(READ_ONLY);
      return;
    }
    this.set({ ...this.state, restoring: true, message: null });
    const backup = backupName(preview.version);
    try {
      await this.store.save(backup);
    } catch (error) {
      this.set({ ...this.state, restoring: false });
      this.failed(errorText(error, RESTORE_FAILED));
      return;
    }
    // Пока сохранялась доска, могли закрыть историю: тогда восстанавливать уже нечего.
    if (this.state.preview !== preview) return;
    if (!this.live.restoreVersion(preview.editor.doc)) {
      this.set({ ...this.state, restoring: false });
      this.failed(READ_ONLY);
      return;
    }
    showSameView(preview.editor, this.live);
    this.leave({
      ...NOTHING_SHOWN,
      message: {
        error: false,
        text: `Версия восстановлена. То, что было на доске до этого, сохранено в истории как «${backup}».`,
      },
    });
  }

  /** Закрывает сообщение о последнем действии. */
  dismissMessage(): void {
    if (this.state.message) this.set({ ...this.state, message: null });
  }

  private leave(state: ViewerState): void {
    this.request += 1;
    this.set({ ...state, preview: null, opening: null, restoring: false });
  }

  private failed(text: string): void {
    this.set({ ...this.state, opening: null, message: { text, error: true } });
  }

  private set(state: ViewerState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
