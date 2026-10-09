# Privacy model and verification

Privacy is a product requirement: raw conversations, generated summaries, questions and findings should remain inside the user's browser session.

## Intended data flow

1. The browser reads the selected `.txt` or `.zip` file using the File API.
2. Parsing, date selection, deterministic analytics, retrieval and rendering run in browser code.
3. When requested, WebLLM runs in a Web Worker and receives selected message chunks locally.
4. The only required remote assets for local AI are model and runtime files from the configured static hosts. Do not use a cloud inference fallback.
5. Exporting TXT/PDF is an explicit user action that downloads the generated briefing to the user's device.

## What may persist

- Conversation content and findings are held in application state for the current tab/session.
- The browser may cache model weights/runtime assets so later loads can avoid another large download.
- The current app does not intentionally save chats to a database, `localStorage` or IndexedDB.

## Current monitor limitation

`src/lib/network-monitor.ts` wraps the `fetch` function in the page and the model worker. It records host, method, body byte count/unknown body status and whether the host is on the configured model-host allowlist. It does not record content. It does **not** intercept all browser network traffic (for example, the monitor is not a replacement for inspecting font requests, other resource types, service worker behavior or DevTools Network). Therefore, the UI says “No chat-bearing fetch request observed,” not “a complete audit proves nothing was sent.”

## Before making a public privacy claim

- Open DevTools → Network and clear the request list.
- Load the landing page, upload only the synthetic sample, then run local analysis.
- Record every hostname requested while the model loads.
- Confirm requests contain model/runtime assets only and no chat message bodies, private content in URLs, or unexpected inference requests.
- Check the deployed Content Security Policy and make sure required model redirect/CDN hosts are explicitly understood rather than guessed.
- Ask a few questions and inspect the Network panel again.
- Test with the browser offline after the model cache is populated, where supported.
- Keep the Privacy page caveat that the in-app fetch monitor is not a complete network audit.

Do not commit genuine exports, screenshots containing private messages, model weights, API keys or other secrets. Threadback should not need an AI provider key.
