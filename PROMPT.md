# Threadback prompt log

This file records the prompts and AI-assisted artifacts used to build Threadback. It is intentionally honest about what was preserved verbatim versus reconstructed from the available project record.

## Prompt index

| ID | Tool / stage | Purpose | Record |
|---|---|---|---|
| P01 | Claude Chat / engineering | Full product, architecture, local AI, UX, build order and landing-page motion brief | [Verbatim prompt](prompts/01-claude-build-brief.md) |
| P02 | Claude Design | Create the approved Threadback landing-page HTML | The exact original chat prompt was not preserved in the supplied files. The resulting design artifact is [`reference/threadback.html`](reference/threadback.html); its design constraints are quoted in P01. Do not treat a reconstructed prompt as verbatim history. |
| P03 | Follow-up implementation in this repository | Complete Steps 7–10: wire import/demo/deep links, workspace and source inspector; add local-model progress/error states; convert the landing reference to React with Motion effects; add privacy, exports, docs and Chrome verification checklist | This follow-up was implemented directly in the repository. A concise continuation brief is provided below, not a claim about an exact prompt previously sent to another model. |

## P03 — continuation brief (drafted for reproducibility)

> Continue the existing Threadback codebase without replacing its parser, retrieval, schema, pipeline or tests. Implement the remaining UI and documentation against the existing engine APIs. Build the import/configuration flow, synthetic demo route and feature deep links; truthful progress and cancellation/error states for local model loading and analysis; a workspace for briefing, personal priorities, decisions, deadlines, tasks, questions, topics, triage, source inspector, Ask/Ask this moment, statistics and privacy; local suggested-reply drafts; local TXT/print-to-PDF export and Clear All Data. Rebuild the supplied `reference/threadback.html` into a Next.js landing page that preserves its palette, Kanit typography, layout/copy, and implements the specified Framer Motion reveal, marquee, character reveal, magnet effect and stacked cards. Keep all chat analysis in browser memory, do not add backend routes, databases, accounts or cloud inference, validate source IDs, and do not overstate the fetch monitor as a complete network audit. Update README, prompt log, architecture/privacy/testing docs and Chrome verification instructions. Run tests/typecheck/build where possible and report tested, untested and incomplete features honestly. Do not invent model-license or download-size facts.

## Recording future prompts

When an additional AI is used, add a new row with its model/tool, purpose and a link to a dated file under `prompts/`. Save the exact prompt and the response/status if relevant. Never put API keys, private chat exports, personal messages or other sensitive input in this repository.
