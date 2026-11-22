import { api, fileUrl, type UploadedFile } from '../api';
import { ImageCache } from '../canvas/images';
import type { FileRef } from '../model/types';

/** Файлы одной доски: загрузка на сервер, адреса для скачивания и картинки для холста. */
export class BoardFiles {
  readonly images: ImageCache;

  constructor(readonly boardId: string) {
    this.images = new ImageCache((fileId) => this.url(fileId));
  }

  url(fileId: string): string {
    return fileUrl(this.boardId, fileId);
  }

  upload(content: Blob, name: string): Promise<UploadedFile> {
    return api.uploadFile(this.boardId, content, name);
  }

  /** Открывает файл: картинку — в новой вкладке, остальное скачивает под своим именем. */
  open(file: FileRef): void {
    const link = document.createElement('a');
    link.href = this.url(file.id);
    if (file.type.startsWith('image/')) {
      link.target = '_blank';
      link.rel = 'noopener';
    } else {
      link.download = file.name;
    }
    link.click();
  }
}
