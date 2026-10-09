# Desktop Chrome / Edge verification checklist

This check is mandatory before claiming the model works. WebGPU detection alone does not prove model loading or inference is successful.

## 1. Run the integrated app

```powershell
npm install
npm test
npm run typecheck
npm run build
npm start
```

Open `http://localhost:3000`. Repeat later against the final Vercel URL. Record any failing command instead of assuming the earlier engine test report still applies to the integrated snapshot.

## 2. UI smoke test

- `/` — landing page, primary CTA and section anchors.
- `/app` — import screen, drag/drop/file picker, `.txt`/`.zip`, participant selector and all catch-up range options.
- `/app?demo=1` — sample chat loads and is clearly labelled synthetic.
- `/app?feature=briefing`, `priorities`, `decisions`, `ask`, `triage` — relevant section opens.
- Verify message source inspector, TXT/print-to-PDF export, copy-only reply drafts and Clear All Data.
- Confirm the mobile navigation and reduced-motion preference do not break access.

## 3. WebGPU and model download

Use desktop Chrome/Edge on a device with a compatible GPU and enough memory. Open DevTools → Network and Console. Clear the request list.

1. Check the page's GPU status and optionally `chrome://gpu`.
2. Click Analyze / Load local AI only after reading the download-size warning.
3. Watch real progress callbacks and record the actual download total.
4. Record every distinct hostname requested by WebLLM, including redirects for model files and compiled runtime assets. The configured initial hosts include `huggingface.co`, its subdomains, `*.hf.co`, and `raw.githubusercontent.com`; the redirect CDN hostname has not been verified.
5. If a CSP refusal occurs, identify the exact resource and host. Add only a understood, necessary host to both `src/config/model.ts` and `next.config.mjs`; do not blindly use `*`.
6. Test whether `response_format: { type: "json_object" }` is supported by the configured model. If it fails, remove JSON mode in `src/lib/engine.ts`; the structured-output repair/retry loop still exists.
7. Record the real weight + runtime download sizes. `MODEL.approxDownloadMB` is currently an estimate, not a measurement.
8. Confirm the exact distributed model license before making use/distribution claims. `MODEL.license` is deliberately marked TODO until verified.

## 4. Real model quality checks

On `/app?demo=1`, analyze the sample chat and check the cases in `docs/TESTING.md`: explicit invoice owner/deadline, changing dinner time, unconfirmed venue, answered/unanswered questions and the injection-looking chat message. Try an unrelated question. Check every citation opens the correct source.

A pipeline test with a fake LLM is not evidence of real model quality.

## 5. Privacy audit

- Monitor the Network tab from before model load through Q&A.
- Confirm application requests do not contain chat text, selected source messages or questions.
- Expect static model/runtime asset downloads only for local inference (plus normal site assets such as fonts). Investigate any unrecognized host.
- The in-app monitor patches `fetch` in the page and worker; it is not a complete network audit. Use DevTools as the source of truth.
- After a successful model load, test a reload and offline behavior if supported by the browser's cache.
- Click Clear All Data and confirm the imported conversation/result is gone; document that browser model cache may remain.

## 6. Capture an honest status

Record: browser/version, OS/GPU, model ID, actual downloaded bytes, hostnames, CSP errors, whether local inference completed, sample-chat findings, Q&A refusal behavior, and any remaining limitations. Do not label any unchecked item “tested.”
