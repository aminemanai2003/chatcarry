import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, Check, ChevronLeft, Download, FileUp, Library, Plus, Save, Search, Settings, Sparkles, Trash2, Unplug, WandSparkles } from 'lucide-react';
import { browser } from 'wxt/browser';
import { createBackup, importBackup } from '../../src/backup';
import { buildSections, enhancePrompt, formatContext, titleFromSnapshot } from '../../src/context-engine';
import { db, searchCards } from '../../src/db';
import { sha256 } from '../../src/hash';
import { originPattern, platformFromUrl } from '../../src/platforms';
import { scanSensitiveText } from '../../src/security';
import type { BridgeRequest, ContextCard, ContextSections, ConversationSnapshot, PanelIntent, PlatformId, Result } from '../../src/types';

type View = 'home' | 'capture' | 'library' | 'enhance' | 'settings' | 'preview';
type Notice = { tone: 'ok' | 'error' | 'warn'; text: string } | null;

const sectionFields: Array<[keyof ContextSections, string, string]> = [
  ['goal', 'Goal', 'What is this conversation trying to achieve?'],
  ['background', 'Background', 'The context the next assistant should know'],
  ['decisions', 'Decisions', 'Choices already made'],
  ['constraints', 'Constraints', 'Requirements, limits, and non-negotiables'],
  ['currentRequest', 'Current request', 'What should happen next?'],
  ['openQuestions', 'Open questions', 'What remains unresolved?'],
  ['artifacts', 'Artifacts', 'Useful links and code'],
  ['excerpts', 'Excerpts', 'Selected conversation passages']
];

const emptySections = Object.fromEntries(sectionFields.map(([key]) => [key, ''])) as ContextSections;

function uuid() { return crypto.randomUUID(); }

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function request<T extends BridgeRequest['type']>(tabId: number, type: T, extra: Record<string, unknown> = {}) {
  const ping = await browser.tabs.sendMessage(tabId, { type: 'CHATCARRY_PING' }) as { documentEpoch?: string };
  const message = { version: 1, requestId: uuid(), documentEpoch: ping.documentEpoch ?? '', type, ...extra };
  return browser.tabs.sendMessage(tabId, message) as Promise<Result<unknown>>;
}

export function App() {
  const [view, setView] = useState<View>('home');
  const [platform, setPlatform] = useState<PlatformId | null>(null);
  const [connected, setConnected] = useState(false);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabTitle, setTabTitle] = useState('Current AI chat');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<ContextSections>(emptySections);
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const [cards, setCards] = useState<ContextCard[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState<ContextCard | null>(null);
  const [insertMode, setInsertMode] = useState<'prepend' | 'replace'>('prepend');
  const [budget, setBudget] = useState(12_000);
  const [prompt, setPrompt] = useState('');
  const [enhanced, setEnhanced] = useState('');
  const [preset, setPreset] = useState<'balanced' | 'concise' | 'detailed'>('balanced');

  async function refreshConnection() {
    const tab = await activeTab();
    const detected = platformFromUrl(tab?.url ?? '');
    setPlatform(detected);
    setTabId(tab?.id ?? null);
    setTabTitle(tab?.title ?? 'Current AI chat');
    if (!detected) { setConnected(false); return; }
    const allowed = await browser.permissions.contains({ origins: [originPattern(detected)] });
    setConnected(allowed);
    if (allowed && tab?.id) await browser.runtime.sendMessage({ type: 'ENSURE_BRIDGE', tabId: tab.id });
  }

  async function refreshCards(nextQuery = query) { setCards(await searchCards(nextQuery)); }

  useEffect(() => {
    void refreshConnection();
    void browser.storage.session.get(['panelIntent']).then(({ panelIntent }) => {
      const intent = panelIntent as PanelIntent | undefined;
      if (intent === 'save') setView('capture');
      if (intent === 'load' || intent === 'library') setView('library');
      if (intent === 'enhance') setView('enhance');
      void browser.storage.session.remove('panelIntent');
    });
  }, []);

  useEffect(() => { if (view === 'library') void refreshCards(); }, [view]);
  useEffect(() => { if (view === 'enhance' && prompt) setEnhanced(enhancePrompt(prompt, preset)); }, [preset]);

  async function connect() {
    if (!platform || tabId == null) return;
    const granted = await browser.permissions.request({ origins: [originPattern(platform)] });
    if (!granted) { setNotice({ tone: 'error', text: 'Site access was not granted.' }); return; }
    await browser.runtime.sendMessage({ type: 'ENSURE_BRIDGE', tabId });
    setConnected(true);
    setNotice({ tone: 'ok', text: 'Connected. ChatCarry only runs when you use it.' });
  }

  async function disconnect() {
    if (!platform) return;
    await browser.permissions.remove({ origins: [originPattern(platform)] });
    setConnected(false);
    setNotice({ tone: 'ok', text: 'Site access removed.' });
  }

  async function capture() {
    if (!tabId) return;
    setBusy(true); setNotice(null);
    try {
      if (!connected) { await connect(); }
      const result = await request(tabId, 'EXTRACT_CONVERSATION') as Result<ConversationSnapshot>;
      if (!result.ok) throw new Error(result.error.message);
      setSnapshot(result.value);
      setTitle(titleFromSnapshot(result.value));
      setSections(buildSections(result.value));
      setNotice({ tone: 'warn', text: `${result.value.loadedMessageCount} loaded messages found. ${result.value.completenessWarning ?? ''}` });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Capture failed.' }); }
    finally { setBusy(false); }
  }

  async function saveCard() {
    if (!snapshot || !title.trim()) return;
    const contentHash = await sha256({ sections, platform: snapshot.platform });
    const existing = await db.cards.where('contentHash').equals(contentHash).first();
    if (existing) { setNotice({ tone: 'warn', text: `This context already exists as “${existing.title}”.` }); return; }
    const now = new Date().toISOString();
    const card: ContextCard = {
      id: uuid(), schemaVersion: 1, title: title.trim(), platform: snapshot.platform,
      sourceUrl: snapshot.url, projectId: null, tags: [], sections,
      transcript: includeTranscript ? snapshot.messages : undefined,
      contentHash, createdAt: now, updatedAt: now
    };
    await db.cards.add(card);
    setNotice({ tone: 'ok', text: 'Context saved locally.' });
    setSelectedCard(card);
    setView('preview');
  }

  async function insertSelected() {
    if (!selectedCard || !tabId) return;
    const formatted = formatContext(selectedCard.sections, budget);
    const findings = scanSensitiveText(formatted.text);
    if (findings.length && !confirm(`Possible sensitive data found (${findings.map((item) => item.kind).join(', ')}). Insert anyway?`)) return;
    setBusy(true);
    try {
      const result = await request(tabId, 'INSERT_TEXT', { text: formatted.text, mode: insertMode });
      if (!result.ok) throw new Error(result.error.message);
      await db.cards.update(selectedCard.id, { lastUsedAt: new Date().toISOString() });
      setNotice({ tone: 'ok', text: `Inserted${formatted.trimmed ? ' with trimming' : ''}. Review it in the prompt box; ChatCarry never sends.` });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Insert failed.' }); }
    finally { setBusy(false); }
  }

  async function readPrompt() {
    if (!tabId) return;
    if (!connected) await connect();
    const result = await request(tabId, 'READ_DRAFT') as Result<{ text: string }>;
    if (result.ok) { setPrompt(result.value.text); setEnhanced(enhancePrompt(result.value.text, preset)); }
    else setNotice({ tone: 'error', text: result.error.message });
  }

  async function insertEnhanced() {
    if (!tabId || !enhanced) return;
    const result = await request(tabId, 'INSERT_TEXT', { text: enhanced, mode: 'replace' });
    setNotice(result.ok ? { tone: 'ok', text: 'Enhanced prompt inserted. Review before sending.' } : { tone: 'error', text: result.error.message });
  }

  async function deleteCard(card: ContextCard) {
    if (!confirm(`Delete “${card.title}”? This cannot be undone.`)) return;
    await db.cards.delete(card.id); await refreshCards();
  }

  async function exportData() {
    const include = confirm('Include full transcripts in the backup? Choose Cancel for context cards only.');
    const blob = new Blob([await createBackup(include)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `chatcarry-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file: File) {
    try {
      const result = await importBackup(await file.text());
      setNotice({ tone: 'ok', text: `Imported ${result.imported}; skipped ${result.skipped} duplicate(s).` });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Invalid backup.' }); }
  }

  const formatted = useMemo(() => selectedCard ? formatContext(selectedCard.sections, budget) : null, [selectedCard, budget]);

  return <main className="app">
    <header className="topbar">
      <button className="brand" onClick={() => setView('home')} aria-label="ChatCarry home"><span className="brandMark">↗</span><span>ChatCarry<small>Carry every conversation forward.</small></span></button>
      <button className="iconButton" onClick={() => setView('settings')} aria-label="Settings"><Settings size={18}/></button>
    </header>

    <div className={`siteStatus ${connected ? 'isConnected' : ''}`}>
      <span className="statusDot"/><div><strong>{platform ? `${platform.charAt(0).toUpperCase()}${platform.slice(1)}` : 'Unsupported page'}</strong><small>{connected ? 'Connected for this site' : tabTitle}</small></div>
      {platform && (connected ? <button className="textButton" onClick={disconnect}><Unplug size={14}/> Remove</button> : <button className="textButton" onClick={connect}>Connect</button>)}
    </div>

    {notice && <div className={`notice ${notice.tone}`}><span>{notice.tone === 'ok' ? <Check size={16}/> : '!'}</span>{notice.text}</div>}

    {view === 'home' && <section className="page home">
      <div className="hero"><p className="eyebrow">LOCAL-FIRST CONTEXT TOOLKIT</p><h1>Continue the work,<br/><em>not the setup.</em></h1><p>Capture what matters from one AI chat and carry it cleanly into the next.</p></div>
      <div className="actionGrid">
        <button className="actionCard primary" onClick={() => setView('capture')}><span><Save size={20}/></span><strong>Save context</strong><small>Turn this loaded chat into an editable card.</small><ArrowRight size={18}/></button>
        <button className="actionCard" onClick={() => setView('library')}><span><Library size={20}/></span><strong>Open library</strong><small>Find and insert context you saved before.</small><ArrowRight size={18}/></button>
        <button className="actionCard" onClick={() => setView('enhance')}><span><WandSparkles size={20}/></span><strong>Enhance prompt</strong><small>Reshape a draft locally using a preset.</small><ArrowRight size={18}/></button>
      </div>
      <div className="privacyNote"><span>◉</span><p><strong>Your chats stay in this browser.</strong><br/>No account, API key, subscription, analytics, or server.</p></div>
    </section>}

    {view === 'capture' && <section className="page">
      <PageTitle title="Save context" subtitle="Capture only the messages currently loaded on this page." onBack={() => setView('home')}/>
      {!snapshot ? <div className="emptyState"><div className="bigIcon"><Archive size={28}/></div><h2>Ready to capture?</h2><p>Scroll up if you need older messages. ChatCarry will read text, code, and safe web links—never attachments.</p><button className="primaryButton" onClick={capture} disabled={busy || !platform}><Sparkles size={17}/>{busy ? 'Reading…' : 'Capture loaded chat'}</button></div>
      : <div className="editor">
        <label>Card title<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)}/></label>
        {sectionFields.map(([key, label, placeholder]) => <label key={key}>{label}<textarea rows={key === 'excerpts' ? 6 : 3} value={sections[key]} placeholder={placeholder} onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.value }))}/></label>)}
        <label className="check"><input type="checkbox" checked={includeTranscript} onChange={(event) => setIncludeTranscript(event.target.checked)}/><span><strong>Keep full transcript</strong><small>Off by default to reduce local storage and backup sensitivity.</small></span></label>
        <button className="primaryButton sticky" onClick={saveCard}><Save size={17}/>Save locally</button>
      </div>}
    </section>}

    {view === 'library' && <section className="page">
      <PageTitle title="Context library" subtitle="Search saved cards across titles, sections, and tags." onBack={() => setView('home')}/>
      <div className="search"><Search size={17}/><input value={query} placeholder="Search context…" onChange={async (event) => { setQuery(event.target.value); await refreshCards(event.target.value); }}/></div>
      <div className="cardList">{cards.map((card) => <article className="libraryCard" key={card.id}>
        <div className="cardMeta"><span className={`platform ${card.platform}`}>{card.platform}</span><time>{new Date(card.updatedAt).toLocaleDateString()}</time></div>
        <h3>{card.title}</h3><p>{card.sections.currentRequest || card.sections.goal || 'No summary yet.'}</p>
        <div className="cardActions"><button onClick={() => { setSelectedCard(card); setView('preview'); }}>Preview & insert <ArrowRight size={15}/></button><button className="dangerIcon" onClick={() => deleteCard(card)} aria-label={`Delete ${card.title}`}><Trash2 size={15}/></button></div>
      </article>)}</div>
      {!cards.length && <div className="emptySmall"><Library size={28}/><h3>No context cards yet</h3><p>Capture your first loaded conversation to build a reusable library.</p><button className="secondaryButton" onClick={() => setView('capture')}><Plus size={16}/>Save context</button></div>}
    </section>}

    {view === 'preview' && selectedCard && formatted && <section className="page">
      <PageTitle title="Preview insertion" subtitle={selectedCard.title} onBack={() => setView('library')}/>
      <div className="segmented"><button className={insertMode === 'prepend' ? 'active' : ''} onClick={() => setInsertMode('prepend')}>Keep draft</button><button className={insertMode === 'replace' ? 'active' : ''} onClick={() => setInsertMode('replace')}>Replace draft</button></div>
      <label className="rangeLabel"><span>Character budget <b>{budget.toLocaleString()}</b></span><input type="range" min="2000" max="50000" step="1000" value={budget} onChange={(event) => setBudget(Number(event.target.value))}/></label>
      <div className="previewText"><div><span>{formatted.text.length.toLocaleString()} characters</span>{formatted.trimmed && <b>Trimmed</b>}</div><pre>{formatted.text}</pre></div>
      <button className="primaryButton sticky" onClick={insertSelected} disabled={busy || !connected}><ArrowRight size={17}/>{busy ? 'Inserting…' : 'Insert into prompt'}</button>
      {!connected && <p className="hint">Connect the current AI site before inserting.</p>}
    </section>}

    {view === 'enhance' && <section className="page">
      <PageTitle title="Enhance prompt" subtitle="A deterministic rewrite that works offline—no AI API required." onBack={() => setView('home')}/>
      <button className="secondaryButton full" onClick={readPrompt}><Download size={16}/>Read current draft</button>
      <label>Original prompt<textarea rows={7} value={prompt} placeholder="Paste or read a draft from the current chat…" onChange={(event) => { setPrompt(event.target.value); setEnhanced(enhancePrompt(event.target.value, preset)); }}/></label>
      <div className="presetRow">{(['balanced', 'concise', 'detailed'] as const).map((item) => <button key={item} className={preset === item ? 'active' : ''} onClick={() => setPreset(item)}>{item}</button>)}</div>
      <label>Enhanced prompt<textarea rows={12} value={enhanced} onChange={(event) => setEnhanced(event.target.value)}/></label>
      <button className="primaryButton sticky" disabled={!enhanced || !connected} onClick={insertEnhanced}><WandSparkles size={17}/>Replace draft with preview</button>
    </section>}

    {view === 'settings' && <section className="page">
      <PageTitle title="Settings & privacy" subtitle="ChatCarry has no backend. Everything below stays in your browser profile." onBack={() => setView('home')}/>
      <div className="settingsCard"><h3>Backup</h3><p>Export a checksummed JSON file. Transcripts are excluded unless you explicitly include them.</p><div className="buttonRow"><button className="secondaryButton" onClick={exportData}><Download size={16}/>Export</button><label className="secondaryButton file"><FileUp size={16}/>Import<input type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); }}/></label></div></div>
      <div className="settingsCard"><h3>Local data</h3><p>IndexedDB is not encrypted at rest. Anyone with access to this browser profile may be able to read saved cards.</p><button className="dangerButton" onClick={async () => { if (confirm('Delete every ChatCarry card and project? This cannot be undone.')) { await db.delete(); location.reload(); } }}><Trash2 size={16}/>Delete all local data</button></div>
      <div className="settingsCard"><h3>What ChatCarry never does</h3><ul><li>No analytics or telemetry</li><li>No cloud sync or remote code</li><li>No automatic capture</li><li>No automatic sending</li></ul></div>
    </section>}

    <footer><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Sparkles size={17}/>Home</button><button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><Library size={17}/>Library</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={17}/>Settings</button></footer>
  </main>;
}

function PageTitle({ title, subtitle, onBack }: { title: string; subtitle: string; onBack(): void }) {
  return <div className="pageTitle"><button className="iconButton" onClick={onBack}><ChevronLeft size={19}/></button><div><h1>{title}</h1><p>{subtitle}</p></div></div>;
}
