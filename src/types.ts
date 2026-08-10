import { z } from 'zod';

export const PlatformIdSchema = z.enum(['chatgpt', 'claude', 'gemini']);
export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool', 'unknown']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const ArtifactSchema = z.object({
  kind: z.enum(['code', 'link']),
  label: z.string().max(240),
  content: z.string().max(100_000),
  language: z.string().max(40).optional()
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  role: MessageRoleSchema,
  text: z.string().max(100_000),
  artifacts: z.array(ArtifactSchema).max(200).default([]),
  selected: z.boolean().default(false)
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  platform: PlatformIdSchema,
  url: z.string().url(),
  title: z.string().max(500),
  capturedAt: z.string().datetime(),
  messages: z.array(ConversationMessageSchema).max(500),
  loadedMessageCount: z.number().int().nonnegative(),
  completenessWarning: z.string().max(500).optional()
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

export const ContextSectionsSchema = z.object({
  goal: z.string().max(20_000),
  background: z.string().max(40_000),
  decisions: z.string().max(20_000),
  constraints: z.string().max(20_000),
  currentRequest: z.string().max(20_000),
  openQuestions: z.string().max(20_000),
  artifacts: z.string().max(100_000),
  excerpts: z.string().max(100_000)
});
export type ContextSections = z.infer<typeof ContextSectionsSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Project = z.infer<typeof ProjectSchema>;

export const ContextCardSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(120),
  platform: PlatformIdSchema,
  sourceUrl: z.string().url(),
  projectId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20),
  sections: ContextSectionsSchema,
  transcript: z.array(ConversationMessageSchema).max(500).optional(),
  contentHash: z.string().min(8),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional()
});
export type ContextCard = z.infer<typeof ContextCardSchema>;

export type ErrorCode =
  | 'UNSUPPORTED_PAGE' | 'PERMISSION_DENIED' | 'STALE_PAGE' | 'STREAMING'
  | 'PAYLOAD_TOO_LARGE' | 'EXTRACTION_FAILED' | 'INSERT_FAILED'
  | 'STORAGE_QUOTA' | 'INVALID_IMPORT' | 'AI_UNAVAILABLE'
  | 'AI_INVALID_OUTPUT' | 'TIMEOUT';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; detail?: string } };

export type PanelIntent = 'save' | 'load' | 'enhance' | 'library';

export type BridgeRequest =
  | { version: 1; requestId: string; type: 'EXTRACT_CONVERSATION'; documentEpoch: string }
  | { version: 1; requestId: string; type: 'READ_DRAFT'; documentEpoch: string }
  | { version: 1; requestId: string; type: 'INSERT_TEXT'; documentEpoch: string; text: string; mode: 'prepend' | 'replace' }
  | { version: 1; requestId: string; type: 'UNDO_INSERT'; documentEpoch: string };

export type BridgeResponse = Result<ConversationSnapshot | { text: string } | { inserted: true } | { undone: true }>;
