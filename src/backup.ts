import { z } from 'zod';
import { db } from './db';
import { canonicalJson, sha256 } from './hash';
import { ContextCardSchema, ProjectSchema, type ContextCard, type Project } from './types';

const BackupPayloadSchema = z.object({
  projects: z.array(ProjectSchema),
  cards: z.array(ContextCardSchema)
});

const BackupSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.string(),
  exportedAt: z.string().datetime(),
  includeTranscripts: z.boolean(),
  payload: BackupPayloadSchema,
  checksum: z.string().length(64)
});

export async function createBackup(includeTranscripts = false): Promise<string> {
  const [projects, cards] = await Promise.all([db.projects.toArray(), db.cards.toArray()]);
  const payload = {
    projects,
    cards: cards.map((card) => includeTranscripts ? card : { ...card, transcript: undefined })
  };
  const envelope = {
    schemaVersion: 1 as const,
    appVersion: '0.2.3',
    exportedAt: new Date().toISOString(),
    includeTranscripts,
    payload
  };
  return JSON.stringify({ ...envelope, checksum: await sha256(canonicalJson(envelope)) }, null, 2);
}

export async function importBackup(raw: string): Promise<{ imported: number; skipped: number }> {
  const parsed = BackupSchema.parse(JSON.parse(raw));
  const { checksum, ...envelope } = parsed;
  if (await sha256(canonicalJson(envelope)) !== checksum) throw new Error('Backup checksum does not match.');

  return db.transaction('rw', db.projects, db.cards, async () => {
    const existingProjects = await db.projects.toArray();
    const projectByName = new Map(existingProjects.map((project) => [project.name.normalize('NFKC').toLocaleLowerCase(), project.id]));
    const projectMap = new Map<string, string>();
    for (const project of parsed.payload.projects) {
      const key = project.name.normalize('NFKC').toLocaleLowerCase();
      const existing = projectByName.get(key);
      if (existing) projectMap.set(project.id, existing);
      else {
        const next = { ...project, id: crypto.randomUUID(), name: project.name } satisfies Project;
        await db.projects.add(next);
        projectMap.set(project.id, next.id);
        projectByName.set(key, next.id);
      }
    }

    let imported = 0;
    let skipped = 0;
    const hashes = new Set((await db.cards.toArray()).map((card) => card.contentHash));
    for (const card of parsed.payload.cards) {
      if (hashes.has(card.contentHash)) { skipped += 1; continue; }
      const idCollision = await db.cards.get(card.id);
      const next: ContextCard = {
        ...card,
        id: idCollision ? crypto.randomUUID() : card.id,
        title: idCollision ? `${card.title} (Imported)` : card.title,
        projectId: card.projectId ? projectMap.get(card.projectId) ?? null : null
      };
      await db.cards.add(next);
      hashes.add(next.contentHash);
      imported += 1;
    }
    return { imported, skipped };
  });
}
