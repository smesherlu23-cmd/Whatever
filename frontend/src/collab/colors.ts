/** Цвета курсоров: различимы между собой и на серой теме. */
export const PEER_COLORS = [
  '#d1495b',
  '#2e86ab',
  '#3c9d5d',
  '#e0892f',
  '#8e5ad6',
  '#c2457f',
  '#1f9e9e',
  '#8a6d3b',
] as const;

export function colorFor(clientId: number): string {
  return PEER_COLORS[clientId % PEER_COLORS.length] ?? PEER_COLORS[0];
}
