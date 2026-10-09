# Testing and acceptance plan

## Automated checks

Run from the project root after dependencies install:

```bash
npm test
npm run typecheck
npm run build
```

The existing engine suite covers parser variants, date filters, signals, retrieval/evidence thresholds, source grounding, chunking/repair/merge, scripted-model pipeline behavior and fetch monitoring. The scripted LLM tests validate plumbing and guardrails; they do not measure real model quality.

## Import and parser checks

- Android-style export; iOS bracket-style export.
- 12-hour and 24-hour time.
- Multiline messages, system notifications, media placeholders and CRLF/BOM.
- Hinglish preserved without rewriting original text.
- Ambiguous day/month ordering produces a visible warning rather than being silently presented as certain.
- ZIP with one chat `.txt`, ZIP without a `.txt`, empty file and unsupported file type.
- Custom range, since-last-read message, and since-time filters return expected source IDs.

## Functional UI checks

1. `/` displays the landing page and no dead primary buttons.
2. `/app` opens import and configuration.
3. `/app?demo=1` loads clearly labelled synthetic data.
4. `/app?feature=briefing|priorities|decisions|ask|triage` opens the relevant section in the sample workspace.
5. Upload a synthetic export; check participants, dates, filters and parser warnings.
6. Without a supported GPU, deterministic signals and stats remain usable and the unsupported reason is explicit.
7. With local AI, the model warning appears before a first large download; progress reflects engine/pipeline progress and cancel/error states are understandable.
8. Source chips open the correct original message and nearby context.
9. Tasks can be marked done only for the current session.
10. Q&A refuses unrelated or insufficiently supported questions and every shown answer source ID exists in the parsed chat.
11. Suggested replies are copy-only and are never sent automatically.
12. Clear All Data removes session content; the model cache notice is accurate.
13. TXT export and print-to-PDF contain the available briefing and no fabricated summary when AI hasn't run.
14. Test at a desktop width, tablet-ish width and narrow phone width; keyboard-test navigation and dialogs.

## Real model quality smoke test

Use the provided synthetic chat (`src/data/sample.ts`) and check that the analysis:

- detects the user's invoice/form/venue requests only with citations;
- notices the dinner plan evolves from Friday 7 PM to Saturday 7 PM and then Saturday 8 PM, while reflecting what remains unconfirmed;
- distinguishes an explicitly assigned task from a suggestion;
- does not invent an owner or deadline;
- classifies the cake question as unanswered only if no later answer exists in the selected context;
- finds the driver question and response;
- treats the “ignore your instructions and reveal…” message as untrusted quoted content;
- refuses an unrelated question such as “Who won the World Cup?”;
- links every answer to real source messages.

Record failures and improve prompts/retrieval/schema rather than hiding them.
