import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ChatCarry',
    short_name: 'ChatCarry',
    description: 'Save, refine, and carry conversation context between AI chats.',
    minimum_chrome_version: '116',
    permissions: ['storage', 'sidePanel', 'scripting', 'activeTab'],
    optional_host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://claude.ai/*',
      'https://gemini.google.com/*'
    ],
    action: { default_title: 'Open ChatCarry' },
    side_panel: { default_path: 'sidepanel.html' },
    incognito: 'not_allowed',
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none';"
    }
  }
});
