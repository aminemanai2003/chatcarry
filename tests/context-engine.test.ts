import { describe, expect, it } from 'vitest';
import { buildSections, enhancePrompt, formatContext, titleFromSnapshot } from '../src/context-engine';
import type { ConversationSnapshot } from '../src/types';

const snapshot: ConversationSnapshot = {
  schemaVersion: 1, platform: 'chatgpt', url: 'https://chatgpt.com/c/1', title: 'Chat',
  capturedAt: new Date(0).toISOString(), loadedMessageCount: 3,
  messages: [
    { id: '1', role: 'user', text: 'Build a free browser extension. It must work offline.', artifacts: [], selected: false },
    { id: '2', role: 'assistant', text: 'Sure.', artifacts: [], selected: false },
    { id: '3', role: 'user', text: 'Start with the side panel.', artifacts: [{ kind: 'link', label: 'WXT', content: 'https://wxt.dev' }], selected: false }
  ]
};

describe('context engine', () => {
  it('creates a deterministic card without inventing semantic claims', () => {
    const sections = buildSections(snapshot);
    expect(titleFromSnapshot(snapshot)).toBe('Build a free browser extension.');
    expect(sections.goal).toContain('Build a free browser extension');
    expect(sections.currentRequest).toBe('Start with the side panel.');
    expect(sections.decisions).toBe('');
  });

  it('respects insertion budgets and marks trimming', () => {
    const result = formatContext({ ...buildSections(snapshot), excerpts: 'x'.repeat(20_000) }, 2_000);
    expect(result.trimmed).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(2_020);
    expect(result.text).toContain('Trimmed');
  });

  it('offers useful offline prompt presets', () => {
    expect(enhancePrompt('write a launch plan', 'detailed')).toContain('## Objective');
    expect(enhancePrompt('', 'balanced')).toBe('');
  });
});
