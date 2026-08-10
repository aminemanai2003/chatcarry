import { browser } from 'wxt/browser';
import type { PanelIntent } from '../src/types';

type RuntimeMessage =
  | { type: 'OPEN_PANEL'; intent: PanelIntent }
  | { type: 'ENSURE_BRIDGE'; tabId: number };

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

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    if (message?.type === 'ENSURE_BRIDGE') return injectBridge(message.tabId).then(() => ({ ok: true }));
    if (message?.type === 'OPEN_PANEL' && sender.tab?.id) {
      void browser.storage.session.set({ panelIntent: message.intent, sourceTabId: sender.tab.id });
      return browser.sidePanel.open({ tabId: sender.tab.id }).then(() => ({ ok: true }));
    }
  });
});
