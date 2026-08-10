import { browser } from 'wxt/browser';
import { buildSections, formatContext, titleFromSnapshot } from '../src/context-engine';
import { db } from '../src/db';
import { sha256 } from '../src/hash';
import { originPattern, platformFromUrl } from '../src/platforms';
import { ConversationSnapshotSchema, type ContextCard, type PanelIntent } from '../src/types';

type RuntimeMessage =
  | { type: 'OPEN_PANEL'; intent: PanelIntent }
  | { type: 'ENSURE_BRIDGE'; tabId: number }
  | { type: 'INLINE_SAVE'; snapshot: unknown }
  | { type: 'INLINE_LIST_CARDS' }
  | { type: 'INLINE_GET_CARD'; cardId: string };

function trustedSender(sender: Browser.runtime.MessageSender) {
  return Boolean(sender.tab?.url && platformFromUrl(sender.tab.url));
}

async function saveInline(snapshotInput: unknown) {
  const parsed = ConversationSnapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) return { ok: false, error: { code: 'EXTRACTION_FAILED', message: 'The captured conversation was invalid.' } };
  const snapshot = parsed.data;
  const sections = buildSections(snapshot);
  const contentHash = await sha256({ sections, platform: snapshot.platform });
  const duplicate = await db.cards.where('contentHash').equals(contentHash).first();
  if (duplicate) return { ok: true, value: { title: duplicate.title, duplicate: true } };
  const now = new Date().toISOString();
  const card: ContextCard = {
    id: crypto.randomUUID(), schemaVersion: 1, title: titleFromSnapshot(snapshot),
    platform: snapshot.platform, sourceUrl: snapshot.url, projectId: null, tags: [],
    sections, contentHash, createdAt: now, updatedAt: now
  };
  await db.cards.add(card);
  return { ok: true, value: { title: card.title, duplicate: false } };
}

async function injectBridge(tabId: number) {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'CHATCARRY_PING' });
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/bridge.js'] });
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    const platform = platformFromUrl(tab.url);
    if (!platform) return;
    void browser.permissions.contains({ origins: [originPattern(platform, tab.url)] }).then((allowed) => {
      if (allowed) return injectBridge(tabId);
    });
  });

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    if (message?.type === 'ENSURE_BRIDGE') return injectBridge(message.tabId).then(() => ({ ok: true }));
    if (message?.type === 'OPEN_PANEL' && sender.tab?.id) {
      void browser.storage.session.set({ panelIntent: message.intent, sourceTabId: sender.tab.id });
      return browser.sidePanel.open({ tabId: sender.tab.id }).then(() => ({ ok: true }));
    }
    if (message?.type === 'INLINE_SAVE' && trustedSender(sender)) return saveInline(message.snapshot);
    if (message?.type === 'INLINE_LIST_CARDS' && trustedSender(sender)) {
      return db.cards.orderBy('updatedAt').reverse().limit(8).toArray().then((cards) => ({
        ok: true,
        value: cards.map((card) => ({ id: card.id, title: card.title, platform: card.platform, summary: card.sections.currentRequest || card.sections.goal }))
      }));
    }
    if (message?.type === 'INLINE_GET_CARD' && trustedSender(sender)) {
      return db.cards.get(message.cardId).then((card) => card
        ? ({ ok: true, value: { text: formatContext(card.sections).text, title: card.title } })
        : ({ ok: false, error: { code: 'INVALID_IMPORT', message: 'That context card no longer exists.' } }));
    }
  });
});
