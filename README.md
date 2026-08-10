# ChatCarry

**Carry every conversation forward.**

ChatCarry is a free, local-first Chromium extension that turns a loaded ChatGPT, Claude, or Gemini conversation into an editable context card. You can keep a searchable local library, preview exactly what will be inserted into another prompt, and improve draft prompts using offline presets.

## What works in v0.1

- Manual capture of loaded text, code blocks, and safe HTTP(S) links
- Deterministic context cards: goal, background, decisions, constraints, current request, open questions, artifacts, and excerpts
- Local IndexedDB library with normalized search and duplicate detection
- Preview, character budget, prepend/replace choice, and a 10-second Undo
- Inline Save / Load / Enhance dock on supported AI sites
- In-page popover anchored beside the prompt box; the side panel is reserved for the full library and settings
- Offline prompt presets: Balanced, Concise, and Detailed
- Checksummed JSON backup and transactional merge import
- Advisory warnings for common secrets and personal contact data
- Per-site optional permissions; no global browsing access

## Privacy and cost

ChatCarry has no backend, account, API key, analytics, cloud database, subscription, or remote code. Saved data stays in the extension's IndexedDB in your browser profile. That storage is **not encrypted at rest**, so protect your browser profile and device.

The extension never captures automatically and never presses Send.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

For a production bundle:

```bash
npm run check
npm run zip
```

Then extract the generated ZIP or load `.output/chrome-mv3` as an unpacked extension at `chrome://extensions` with Developer mode enabled.

## Supported pages

- `https://chatgpt.com/*`
- `https://claude.ai/*`
- `https://gemini.google.com/*`

AI sites change their DOM frequently. The adapter fixtures and selectors should be updated when a site redesigns its message or composer markup.

## License

MIT © Amine Manai
