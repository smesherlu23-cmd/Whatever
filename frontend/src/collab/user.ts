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

const NAME_KEY = 'whatever-user-name';

export function loadUserName(): string {
  const saved = localStorage.getItem(NAME_KEY);
  if (saved) return saved;
  const name = `Гость ${Math.floor(1000 + Math.random() * 9000)}`;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

export function saveUserName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function colorFor(clientId: number): string {
  return PEER_COLORS[clientId % PEER_COLORS.length] ?? PEER_COLORS[0];
}
