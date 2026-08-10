import { adapters, platformFromUrl } from '../src/platforms';
import { safeHttpUrl } from '../src/security';
import type { Artifact, BridgeRequest, ConversationMessage, ConversationSnapshot, Result } from '../src/types';

declare global { interface Window { __chatcarryInstalled?: boolean } }

let previousDraft: { element: HTMLElement; value: string; isInput: boolean } | null = null;
let undoTimer: number | null = null;
const documentEpoch = crypto.randomUUID();

const fail = (code: 'UNSUPPORTED_PAGE' | 'STALE_PAGE' | 'EXTRACTION_FAILED' | 'INSERT_FAILED' | 'PAYLOAD_TOO_LARGE', message: string) =>
  ({ ok: false, error: { code, message } } as const);

function composer(): HTMLElement | null {
  const platform = platformFromUrl(location.href);
  if (!platform) return null;
  for (const selector of adapters[platform].composerSelectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function currentValue(element: HTMLElement): string {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element.value : element.innerText;
}

function setValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) element.value = value;
  else element.textContent = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.focus();
}

function extractArtifacts(element: Element): Artifact[] {
  const links: Artifact[] = [...element.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((link) => {
    const href = safeHttpUrl(link.href);
    return href ? [{ kind: 'link' as const, label: (link.innerText || href).slice(0, 240), content: href }] : [];
  });
  const code: Artifact[] = [...element.querySelectorAll<HTMLElement>('pre code')].map((node) => ({
    kind: 'code', label: 'Code block', content: node.innerText.slice(0, 100_000),
    language: [...node.classList].find((name) => name.startsWith('language-'))?.replace('language-', '')
  }));
  return [...links, ...code].slice(0, 200);
}

function extract(): Result<ConversationSnapshot> {
  const platform = platformFromUrl(location.href);
  if (!platform) return fail('UNSUPPORTED_PAGE', 'Open ChatGPT, Claude, or Gemini first.');
  try {
    const adapter = adapters[platform];
    const elements = [...new Set(adapter.messageSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    const messages: ConversationMessage[] = elements.slice(-500).map((element, index) => ({
      id: element.getAttribute('data-message-id') ?? `${platform}-${index}`,
      role: adapter.roleFor(element),
      text: (element as HTMLElement).innerText.trim().slice(0, 100_000),
      artifacts: extractArtifacts(element),
      selected: false
    })).filter((message) => message.text);
    const total = messages.reduce((sum, message) => sum + message.text.length, 0);
    if (total > 2_000_000) return fail('PAYLOAD_TOO_LARGE', 'This loaded conversation is over 2 MB. Start from a shorter or partially loaded view.');
    const warning = elements.length >= 500
      ? 'Only the latest 500 loaded messages were captured.'
      : 'Only messages currently loaded by the page are visible to ChatCarry. Scroll up first for older history.';
    return { ok: true, value: {
      schemaVersion: 1, platform, url: location.href, title: document.title,
      capturedAt: new Date().toISOString(), messages,
      loadedMessageCount: messages.length, completenessWarning: warning
    }};
  } catch (error) {
    return fail('EXTRACTION_FAILED', 'The page layout changed and ChatCarry could not read this conversation.');
  }
}

function toast(message: string, undo = false) {
  const root = document.getElementById('chatcarry-toast');
  root?.remove();
  const node = document.createElement('div');
  node.id = 'chatcarry-toast';
  Object.assign(node.style, { position: 'fixed', right: '24px', bottom: '92px', zIndex: '2147483647', background: '#172033', color: '#fff', padding: '12px 14px', borderRadius: '12px', font: '600 13px system-ui', boxShadow: '0 12px 36px #0005' });
  node.textContent = message;
  if (undo) {
    const button = document.createElement('button');
    button.textContent = 'Undo';
    Object.assign(button.style, { marginLeft: '12px', color: '#c7d2fe', background: 'transparent', border: '0', cursor: 'pointer', fontWeight: '700' });
    button.onclick = () => { if (previousDraft) setValue(previousDraft.element, previousDraft.value); previousDraft = null; node.remove(); };
    node.append(button);
  }
  document.documentElement.append(node);
  window.setTimeout(() => node.remove(), 10_000);
}

function installDock() {
  if (document.getElementById('chatcarry-dock-host')) return;
  const host = document.createElement('div');
  host.id = 'chatcarry-dock-host';
  Object.assign(host.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483646' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    *{box-sizing:border-box} .dock{display:flex;gap:8px;padding:8px;background:#fff;border:1px solid #d9def0;border-radius:16px;box-shadow:0 16px 44px #1720332d;font:600 13px system-ui;color:#172033}
    button{border:0;border-radius:10px;padding:10px 12px;background:#f1f2f8;color:inherit;cursor:pointer}button:first-child{background:#5b5bd6;color:#fff}button:hover{filter:brightness(.97)}
    .mark{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:#ececff;color:#5b5bd6;font-size:19px}
  </style><div class="dock"><span class="mark">↗</span><button data-intent="save">Save context</button><button data-intent="load">Load</button><button data-intent="enhance">Enhance</button></div>`;
  shadow.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.onclick = () => {
    void chrome.runtime.sendMessage({ type: 'OPEN_PANEL', intent: button.dataset.intent });
  });
  document.documentElement.append(host);
}

export default defineUnlistedScript(() => {
  if (window.__chatcarryInstalled) return;
  window.__chatcarryInstalled = true;
  installDock();
  chrome.runtime.onMessage.addListener((message: BridgeRequest | { type: 'CHATCARRY_PING' }, _sender, sendResponse) => {
    if (message.type === 'CHATCARRY_PING') { sendResponse({ ok: true, documentEpoch }); return; }
    if (message.documentEpoch && message.documentEpoch !== documentEpoch) { sendResponse(fail('STALE_PAGE', 'The source page changed. Try again.')); return; }
    if (message.type === 'EXTRACT_CONVERSATION') { sendResponse(extract()); return; }
    if (message.type === 'READ_DRAFT') {
      const element = composer();
      sendResponse(element ? { ok: true, value: { text: currentValue(element) } } : fail('INSERT_FAILED', 'Could not find the prompt box.'));
      return;
    }
    if (message.type === 'INSERT_TEXT') {
      const element = composer();
      if (!element) { sendResponse(fail('INSERT_FAILED', 'Could not find the prompt box.')); return; }
      const original = currentValue(element);
      previousDraft = { element, value: original, isInput: element instanceof HTMLTextAreaElement };
      const separator = original.trim() ? '\n\n---\n\n' : '';
      setValue(element, message.mode === 'replace' ? message.text : `${message.text}${separator}${original}`);
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = window.setTimeout(() => { previousDraft = null; }, 10_000);
      toast('Context inserted — review before sending.', true);
      sendResponse({ ok: true, value: { inserted: true } });
      return;
    }
    if (message.type === 'UNDO_INSERT') {
      if (previousDraft) setValue(previousDraft.element, previousDraft.value);
      previousDraft = null;
      sendResponse({ ok: true, value: { undone: true } });
    }
  });
});
