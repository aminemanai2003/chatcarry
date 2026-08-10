import { adapters, platformFromUrl } from '../src/platforms';
import { enhancePrompt } from '../src/context-engine';
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

function insertIntoComposer(text: string, mode: 'prepend' | 'replace') {
  const element = composer();
  if (!element) return fail('INSERT_FAILED', 'Could not find the prompt box.');
  const original = currentValue(element);
  previousDraft = { element, value: original, isInput: element instanceof HTMLTextAreaElement };
  const separator = original.trim() ? '\n\n---\n\n' : '';
  setValue(element, mode === 'replace' ? text : `${text}${separator}${original}`);
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => { previousDraft = null; }, 10_000);
  toast('Inserted — review before sending.', true);
  return { ok: true, value: { inserted: true } } as const;
}

function installDock() {
  if (document.getElementById('chatcarry-dock-host')) return;
  const host = document.createElement('div');
  host.id = 'chatcarry-dock-host';
  Object.assign(host.style, { position: 'fixed', zIndex: '2147483646', opacity: '0', transition: 'opacity .18s ease' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{--cc-bg:#11131a;--cc-card:#181b24;--cc-line:#303545;--cc-text:#f6f7fb;--cc-muted:#9aa3b8;--cc-brand:#6464e8;--cc-soft:#292955;font:600 13px Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--cc-text)}
    :host([data-theme="light"]){--cc-bg:#fff;--cc-card:#f6f7fb;--cc-line:#dfe3ee;--cc-text:#172033;--cc-muted:#6f778a;--cc-soft:#ececff}
    *{box-sizing:border-box}.dock{display:flex;justify-content:flex-end;align-items:center;gap:9px}.orb,.enhance{border:1px solid #7777ef;background:linear-gradient(135deg,#5145cd,#7449b4);color:#fff;box-shadow:0 10px 28px #29225d59;cursor:pointer}
    .orb{width:47px;height:47px;padding:0;border-radius:50%;display:grid;place-items:center}.orb svg{width:25px;height:25px}.enhance{height:47px;padding:0 20px;border-radius:24px;font:750 14px inherit;letter-spacing:.01em}.enhance span{color:#ffd15c;margin-right:7px}.orb:hover,.enhance:hover{filter:brightness(1.09);transform:translateY(-1px)}
    .panel{position:absolute;right:0;bottom:58px;width:min(330px,calc(100vw - 24px));max-height:min(480px,70vh);overflow:auto;padding:14px;background:var(--cc-bg);border:1px solid var(--cc-line);border-radius:18px;box-shadow:0 22px 60px #0007}.panel[hidden],.view[hidden]{display:none}
    .head{display:flex;align-items:center;justify-content:space-between;padding:0 2px 11px;border-bottom:1px solid var(--cc-line)}.head strong{font-size:12px;letter-spacing:.1em}.close,.back{border:0;background:transparent;color:var(--cc-muted);cursor:pointer;font-size:18px;padding:2px 5px}.back{font-size:12px;font-weight:700}
    .actions{display:grid;gap:9px;padding-top:12px}.action{display:flex;align-items:center;gap:11px;width:100%;padding:12px;border:1px solid var(--cc-line);border-radius:13px;background:var(--cc-card);color:var(--cc-text);cursor:pointer;text-align:left}.action.primary{background:linear-gradient(100deg,#5265eb,#8b61bc);border-color:transparent;color:#fff}.action:hover{filter:brightness(1.06)}.action .icon{width:32px;height:32px;border-radius:9px;background:#ffffff18;display:grid;place-items:center;font-size:17px}.copy{flex:1}.copy strong,.copy small{display:block}.copy small{font-size:10px;color:var(--cc-muted);margin-top:2px}.primary .copy small{color:#e6e8ff}
    .status{min-height:18px;margin:9px 2px 0;color:var(--cc-muted);font-size:10px;line-height:1.4}.status.error{color:#ff8d86}.cards{display:grid;gap:7px;margin-top:10px}.card{width:100%;border:1px solid var(--cc-line);border-radius:11px;background:var(--cc-card);color:var(--cc-text);padding:10px;text-align:left;cursor:pointer}.card:hover{border-color:#7777e9}.card strong,.card small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card strong{font-size:11px}.card small{font-size:9px;color:var(--cc-muted);margin-top:3px}.empty{padding:24px 8px;text-align:center;color:var(--cc-muted);font-size:11px}
    .presets{display:flex;gap:5px;margin:11px 0 8px}.preset{flex:1;padding:7px 4px;border:1px solid var(--cc-line);border-radius:8px;background:var(--cc-card);color:var(--cc-muted);font:700 9px inherit;text-transform:capitalize;cursor:pointer}.preset.active{background:var(--cc-soft);color:var(--cc-text);border-color:#6f6fdb}.preview{width:100%;min-height:150px;max-height:260px;resize:vertical;border:1px solid var(--cc-line);border-radius:11px;background:var(--cc-card);color:var(--cc-text);padding:10px;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.apply,.dashboard{width:100%;margin-top:9px;border:0;border-radius:10px;padding:10px;background:var(--cc-brand);color:#fff;font:750 11px inherit;cursor:pointer}.dashboard{background:transparent;color:var(--cc-muted);border:1px solid var(--cc-line)}
  </style>
  <div class="panel" hidden>
    <div class="head"><strong>CHATCARRY</strong><button class="close" aria-label="Close">×</button></div>
    <div class="view home"><div class="actions">
      <button class="action primary save"><span class="icon">▣</span><span class="copy"><strong>Save context</strong><small>Capture the messages loaded on this page</small></span><span>›</span></button>
      <button class="action load"><span class="icon">▤</span><span class="copy"><strong>Load context</strong><small>Insert one of your saved cards</small></span><span>›</span></button>
    </div><div class="status"></div><button class="dashboard">Open full library & settings</button></div>
    <div class="view library" hidden><button class="back">← Back</button><div class="cards"></div></div>
    <div class="view enhancer" hidden><button class="back">← Back</button><div class="presets"><button class="preset active" data-preset="balanced">Balanced</button><button class="preset" data-preset="concise">Concise</button><button class="preset" data-preset="detailed">Detailed</button></div><textarea class="preview" aria-label="Enhanced prompt preview"></textarea><button class="apply">Replace draft with preview</button></div>
  </div>
  <div class="dock"><button class="orb" aria-label="Open ChatCarry"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 4.5A3.5 3.5 0 0 0 4.5 8v1.2A3.8 3.8 0 0 0 3 12.3 3.7 3.7 0 0 0 6.7 16H8m8-11.5A3.5 3.5 0 0 1 19.5 8v1.2a3.8 3.8 0 0 1 1.5 3.1 3.7 3.7 0 0 1-3.7 3.7H16M8 4.5V19m8-14.5V19M8 8h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2M16 8h-1a3 3 0 0 0-3 3"/></svg></button><button class="enhance"><span>⚡</span>Enhance prompt</button></div>`;

  const panel = shadow.querySelector<HTMLElement>('.panel')!;
  const home = shadow.querySelector<HTMLElement>('.home')!;
  const library = shadow.querySelector<HTMLElement>('.library')!;
  const enhancer = shadow.querySelector<HTMLElement>('.enhancer')!;
  const status = shadow.querySelector<HTMLElement>('.status')!;
  const preview = shadow.querySelector<HTMLTextAreaElement>('.preview')!;
  let activePreset: 'balanced' | 'concise' | 'detailed' = 'balanced';
  let originalPrompt = '';

  const show = (view: 'home' | 'library' | 'enhancer') => {
    panel.hidden = false; home.hidden = view !== 'home'; library.hidden = view !== 'library'; enhancer.hidden = view !== 'enhancer';
  };
  const setStatus = (text: string, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  const openEnhancer = () => {
    const element = composer();
    if (!element) { toast('Could not find the prompt box.'); return; }
    originalPrompt = currentValue(element);
    if (!originalPrompt.trim()) { toast('Write a draft first, then enhance it.'); return; }
    preview.value = enhancePrompt(originalPrompt, activePreset); show('enhancer');
  };

  shadow.querySelector<HTMLButtonElement>('.orb')!.onclick = () => panel.hidden ? show('home') : panel.hidden = true;
  shadow.querySelector<HTMLButtonElement>('.enhance')!.onclick = openEnhancer;
  shadow.querySelector<HTMLButtonElement>('.close')!.onclick = () => { panel.hidden = true; };
  shadow.querySelectorAll<HTMLButtonElement>('.back').forEach((button) => button.onclick = () => show('home'));
  shadow.querySelector<HTMLButtonElement>('.dashboard')!.onclick = () => { void chrome.runtime.sendMessage({ type: 'OPEN_PANEL', intent: 'library' }); panel.hidden = true; };
  shadow.querySelector<HTMLButtonElement>('.save')!.onclick = async () => {
    setStatus('Reading the loaded conversation…');
    const captured = extract();
    if (!captured.ok) { setStatus(captured.error.message, true); return; }
    if (!captured.value.messages.length) { setStatus('No loaded messages were found. The site layout may have changed.', true); return; }
    try {
      const result = await chrome.runtime.sendMessage({ type: 'INLINE_SAVE', snapshot: captured.value });
      if (!result?.ok) { setStatus(result?.error?.message ?? 'Could not save this context.', true); return; }
      setStatus(result.value.duplicate ? `Already saved as “${result.value.title}”.` : `Saved “${result.value.title}” locally.`);
    } catch { setStatus('Could not reach ChatCarry. Reload this page and try again.', true); }
  };
  shadow.querySelector<HTMLButtonElement>('.load')!.onclick = async () => {
    show('library');
    const cardsRoot = shadow.querySelector<HTMLElement>('.cards')!;
    cardsRoot.replaceChildren();
    const loading = document.createElement('div'); loading.className = 'empty'; loading.textContent = 'Loading your library…'; cardsRoot.append(loading);
    try {
      const result = await chrome.runtime.sendMessage({ type: 'INLINE_LIST_CARDS' });
      cardsRoot.replaceChildren();
      if (!result?.ok || !result.value.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No saved context yet.'; cardsRoot.append(empty); return; }
      for (const item of result.value as Array<{ id: string; title: string; platform: string; summary: string }>) {
        const button = document.createElement('button'); button.className = 'card';
        const title = document.createElement('strong'); title.textContent = item.title;
        const summary = document.createElement('small'); summary.textContent = item.summary || `Saved from ${item.platform}`;
        button.append(title, summary);
        button.onclick = async () => {
          button.textContent = 'Preparing context…';
          const card = await chrome.runtime.sendMessage({ type: 'INLINE_GET_CARD', cardId: item.id });
          if (!card?.ok) { toast(card?.error?.message ?? 'Could not load that card.'); return; }
          insertIntoComposer(card.value.text, 'prepend'); panel.hidden = true;
        };
        cardsRoot.append(button);
      }
    } catch { cardsRoot.textContent = 'Could not load the library.'; }
  };
  shadow.querySelectorAll<HTMLButtonElement>('.preset').forEach((button) => button.onclick = () => {
    activePreset = button.dataset.preset as typeof activePreset;
    shadow.querySelectorAll('.preset').forEach((item) => item.classList.toggle('active', item === button));
    preview.value = enhancePrompt(originalPrompt, activePreset);
  });
  shadow.querySelector<HTMLButtonElement>('.apply')!.onclick = () => { insertIntoComposer(preview.value, 'replace'); panel.hidden = true; };

  const position = () => {
    const element = composer();
    if (!element) { host.style.opacity = '0'; return; }
    const rect = element.getBoundingClientRect();
    const width = Math.min(360, Math.max(250, rect.width));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const below = rect.bottom + 11;
    const top = below + 55 < window.innerHeight ? below : Math.max(12, rect.top - 58);
    host.style.width = `${width}px`; host.style.left = `${left}px`; host.style.top = `${top}px`; host.style.opacity = '1';
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
    host.dataset.theme = ((rgb[0] ?? 255) + (rgb[1] ?? 255) + (rgb[2] ?? 255)) / 3 > 145 ? 'light' : 'dark';
  };
  document.documentElement.append(host);
  position();
  window.addEventListener('resize', position, { passive: true });
  window.addEventListener('scroll', position, { passive: true, capture: true });
  window.setInterval(position, 900);
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
      sendResponse(insertIntoComposer(message.text, message.mode));
      return;
    }
    if (message.type === 'UNDO_INSERT') {
      if (previousDraft) setValue(previousDraft.element, previousDraft.value);
      previousDraft = null;
      sendResponse({ ok: true, value: { undone: true } });
    }
  });
});
