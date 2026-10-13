# Sleek Desktop Assistant

A sleek, top-pinned desktop assistant built with **Tauri 2**, **Rust**, **React**, **TypeScript**, and **Tailwind CSS**.

## Features

- **Top-Center Edge Bar:** Frameless, transparent, dark-glass window (720px width) pinned to the top-center of the primary monitor.
- **Hover Intent Trigger:** Toki-based ~30ms cursor polling task expands the bar when hovering within 2px of the top edge for 150ms. Collapses after 400ms when mouse leaves the bar area and input is unfocused.
- **Global Hotkey:** `Ctrl+Space` fallback toggle.
- **Dark Glass Aesthetic:** Acrylic/Mica dark surface, subtle borders, Inter font, and loading shimmer.
- **Gemini Streaming:** Reqwest streaming client using `streamGenerateContent?alt=sse` with `gemini-2.5-flash`.
- **OS Keychain Storage:** API key stored safely in OS keychain via `keyring` crate with graceful secure fallback storage.
- **Markdown & Code Blocks:** Rich text rendering with GFM support and one-click copy buttons.
- **Quick Action Chips:** Ask Clipboard, Summarize, Rewrite, Translate, and Explain.
- **Personas & Screen Context:** Choose system prompt personas (Coder, Writer, Concise) and attach screen context to prompt queries.
- **System Tray & Autostart:** Quick toggles and launch at login support.

## Run & Development Instructions

### Prerequisites
- Node.js (v18+) & `npm`
- Rust toolchain (`cargo` 1.80+)

### Setup
```bash
npm install
```

### Running in Development Mode
```bash
npm run tauri dev
```

### Building for Production
```bash
npm run tauri build
```

## Architecture Overview
- `src-tauri/src/window.rs`: Window management, cursor polling (~30ms), click-through state toggling.
- `src-tauri/src/gemini.rs`: Reqwest SSE streaming client, parser, and in-memory session history.
- `src-tauri/src/secrets.rs`: Keychain and fallback API key store.
- `src/App.tsx`: Sleek React Dark Glass interface and animations.
