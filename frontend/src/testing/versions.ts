import type { BoardVersion } from '../api';
import { ANNA } from './comments';

/** Автоматическая версия, которую правила Анна. С name версия названная, её сохранила Анна. */
export function version(
  id: string,
  createdAt: string,
  fields: Partial<BoardVersion> = {},
): BoardVersion {
  const name = fields.name ?? null;
  return {
    id,
    name,
    created_at: createdAt,
    saved_by: name === null ? null : ANNA,
    editors: [ANNA],
    ...fields,
  };
}
