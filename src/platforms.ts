import type { ConversationMessage, PlatformId } from './types';

type AdapterDefinition = {
  id: PlatformId;
  hosts: string[];
  messageSelectors: string[];
  composerSelectors: string[];
  roleFor(element: Element): ConversationMessage['role'];
};

const roleFromText = (value: string | null): ConversationMessage['role'] => {
  const role = value?.toLowerCase() ?? '';
  if (role.includes('user') || role.includes('human')) return 'user';
  if (role.includes('assistant') || role.includes('model')) return 'assistant';
  if (role.includes('system')) return 'system';
  if (role.includes('tool')) return 'tool';
  return 'unknown';
};

export const adapters: Record<PlatformId, AdapterDefinition> = {
  chatgpt: {
    id: 'chatgpt',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    messageSelectors: ['[data-message-author-role]'],
    composerSelectors: ['#prompt-textarea', 'textarea[data-id="root"]'],
    roleFor: (el) => roleFromText(el.getAttribute('data-message-author-role'))
  },
  claude: {
    id: 'claude',
    hosts: ['claude.ai'],
    messageSelectors: [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-is-streaming]'
    ],
    composerSelectors: [
      '[contenteditable="true"][data-testid*="input"]',
      'div[contenteditable="true"].ProseMirror'
    ],
    roleFor: (el) => el.matches('[data-testid="user-message"]') ? 'user' : 'assistant'
  },
  gemini: {
    id: 'gemini',
    hosts: ['gemini.google.com'],
    messageSelectors: ['user-query', 'model-response'],
    composerSelectors: ['rich-textarea [contenteditable="true"]', '.ql-editor[contenteditable="true"]'],
    roleFor: (el) => el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant'
  }
};

export function platformFromUrl(url: string): PlatformId | null {
  try {
    const hostname = new URL(url).hostname;
    return (Object.values(adapters).find((adapter) => adapter.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)))?.id) ?? null;
  } catch {
    return null;
  }
}

export function originPattern(platform: PlatformId, currentUrl?: string): string {
  if (currentUrl) {
    try {
      const hostname = new URL(currentUrl).hostname;
      if (adapters[platform].hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return `https://${hostname}/*`;
    } catch { /* Fall back to the primary host. */ }
  }
  return `https://${adapters[platform].hosts[0]}/*`;
}
