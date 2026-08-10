import Dexie, { type EntityTable } from 'dexie';
import type { ContextCard, Project } from './types';

export class ChatCarryDatabase extends Dexie {
  cards!: EntityTable<ContextCard, 'id'>;
  projects!: EntityTable<Project, 'id'>;

  constructor(name = 'chatcarry') {
    super(name);
    this.version(1).stores({
      cards: 'id, title, platform, projectId, contentHash, updatedAt, lastUsedAt, *tags',
      projects: 'id, &name, updatedAt'
    });
  }
}

export const db = new ChatCarryDatabase();

export function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

export async function searchCards(query: string): Promise<ContextCard[]> {
  const cards = await db.cards.toArray();
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const score = (card: ContextCard) => {
    const title = normalizeSearch(card.title);
    const body = normalizeSearch([
      card.title, card.tags.join(' '), ...Object.values(card.sections)
    ].join(' '));
    if (!terms.every((term) => body.includes(term))) return -1;
    if (title === normalizeSearch(query)) return 3;
    if (title.startsWith(normalizeSearch(query))) return 2;
    return 1;
  };
  return cards.filter((card) => score(card) >= 0).sort((a, b) =>
    score(b) - score(a) || (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt)
  );
}
