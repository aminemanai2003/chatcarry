import type { ContextSections, ConversationMessage, ConversationSnapshot } from './types';

const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();

const distinct = (messages: ConversationMessage[]) => {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = normalize(message.text).toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const clamp = (text: string, max: number) => {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

export function titleFromSnapshot(snapshot: ConversationSnapshot): string {
  const first = snapshot.messages.find((message) => message.role === 'user' && normalize(message.text));
  const sentence = first?.text.split(/(?<=[.!?])\s/)[0] ?? snapshot.title ?? 'Untitled context';
  return clamp(normalize(sentence), 80) || 'Untitled context';
}

export function buildSections(snapshot: ConversationSnapshot): ContextSections {
  const users = distinct(snapshot.messages.filter((message) => message.role === 'user'));
  const first = users[0];
  const latest = users.at(-1);
  const backgroundMessages = distinct([...(first ? [first] : []), ...users.slice(-3)]);
  const excerptSource = snapshot.messages.some((message) => message.selected)
    ? snapshot.messages.filter((message) => message.selected)
    : snapshot.messages.slice(-12);
  const artifactLines = snapshot.messages.flatMap((message) => message.artifacts).map((artifact) => {
    if (artifact.kind === 'link') return `- [${artifact.label}](${artifact.content})`;
    const fence = artifact.content.includes('```') ? '````' : '```';
    return `${fence}${artifact.language ?? ''}\n${artifact.content}\n${fence}`;
  });

  return {
    goal: clamp(normalize(first?.text ?? ''), 1500),
    background: backgroundMessages.map((message) => `- ${normalize(message.text)}`).join('\n'),
    decisions: '',
    constraints: '',
    currentRequest: normalize(latest?.text ?? ''),
    openQuestions: '',
    artifacts: artifactLines.join('\n\n'),
    excerpts: excerptSource.map((message) => `**${message.role}:** ${normalize(message.text)}`).join('\n\n')
  };
}

const labels: Array<[keyof ContextSections, string]> = [
  ['goal', 'Goal'], ['background', 'Background'], ['decisions', 'Decisions'],
  ['constraints', 'Constraints'], ['currentRequest', 'Current request'],
  ['openQuestions', 'Open questions'], ['artifacts', 'Artifacts'], ['excerpts', 'Conversation excerpts']
];

function block(key: keyof ContextSections, value: string): string {
  const label = labels.find(([candidate]) => candidate === key)?.[1] ?? key;
  return value.trim() ? `## ${label}\n${value.trim()}` : '';
}

export function formatContext(sections: ContextSections, budget = 12_000): { text: string; trimmed: boolean } {
  const working = { ...sections };
  const render = () => ['# Carried context', ...labels.map(([key]) => block(key, working[key])).filter(Boolean)].join('\n\n');
  let text = render();
  if (text.length <= budget) return { text, trimmed: false };

  for (const key of ['background', 'excerpts', 'artifacts'] as const) {
    while (text.length > budget && working[key]) {
      const paragraphs = working[key].split(/\n\n|\n(?=- )/);
      if (paragraphs.length <= 1) {
        const overflow = text.length - budget;
        working[key] = clamp(working[key], Math.max(0, working[key].length - overflow - 20));
      } else {
        paragraphs.shift();
        working[key] = paragraphs.join('\n\n');
      }
      text = render();
    }
  }
  if (text.length > budget) text = `${text.slice(0, Math.max(0, budget - 16)).trimEnd()}\n\n_[Trimmed]_`;
  else text += '\n\n_[Trimmed]_';
  return { text, trimmed: true };
}

export function enhancePrompt(prompt: string, preset: 'balanced' | 'concise' | 'detailed'): string {
  const clean = normalize(prompt);
  if (!clean) return '';
  if (preset === 'concise') return `Task: ${clean}\n\nRespond directly. Use concise language and include only information needed to complete the task.`;
  if (preset === 'detailed') return `## Objective\n${clean}\n\n## Response requirements\n- State assumptions explicitly.\n- Work through the important reasoning and trade-offs.\n- Provide a complete, practical result with examples where useful.\n- End with clear next actions.`;
  return `## Task\n${clean}\n\n## Instructions\n- Preserve the user's intent and constraints.\n- Ask only if missing information would materially change the answer.\n- Produce a clear, actionable response.\n- Flag uncertainty instead of inventing facts.`;
}
