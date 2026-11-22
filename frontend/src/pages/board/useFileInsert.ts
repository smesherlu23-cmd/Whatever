import { useCallback, useState } from 'react';
import type { Editor } from '../../editor/Editor';
import { type InsertReport, insertFiles } from '../../editor/insertFiles';
import type { BoardFiles } from '../../files/boardFiles';
import type { Point } from '../../model/types';

export interface FileInsert {
  /** Загружает файлы и ставит их на доску с серединой в точке at. */
  insert: (files: File[], at: Point) => Promise<void>;
  /** Сколько файлов сейчас загружается. */
  uploading: number;
  /** Что не удалось вставить в последний раз. */
  error: string | null;
  dismissError: () => void;
}

function failureText(failed: InsertReport['failed']): string | null {
  const [first, ...rest] = failed;
  if (!first) return null;
  const more = rest.length > 0 ? ` Не вставлено и других файлов: ${rest.length}.` : '';
  return `Не удалось вставить «${first.name}». ${first.reason}.${more}`;
}

/** Вставка картинок и файлов на доску с отчётом для пользователя. */
export function useFileInsert(editor: Editor, files: BoardFiles): FileInsert {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const insert = useCallback(
    async (chosen: File[], at: Point) => {
      setError(null);
      setUploading((n) => n + chosen.length);
      try {
        const report = await insertFiles(editor, chosen, at, (content, name) =>
          files.upload(content, name),
        );
        setError(failureText(report.failed));
      } finally {
        setUploading((n) => n - chosen.length);
      }
    },
    [editor, files],
  );
  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  return { insert, uploading, error, dismissError };
}
