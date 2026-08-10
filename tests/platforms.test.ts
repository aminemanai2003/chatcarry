import { describe, expect, it } from 'vitest';
import { originPattern, platformFromUrl } from '../src/platforms';

describe('supported AI pages', () => {
  it('recognizes current and legacy ChatGPT hosts', () => {
    expect(platformFromUrl('https://chatgpt.com/?model=gpt-5')).toBe('chatgpt');
    expect(platformFromUrl('https://chat.openai.com/c/example')).toBe('chatgpt');
  });

  it('requests only the active supported host', () => {
    expect(originPattern('chatgpt', 'https://chat.openai.com/c/example')).toBe('https://chat.openai.com/*');
    expect(originPattern('claude', 'https://claude.ai/new')).toBe('https://claude.ai/*');
  });
});
