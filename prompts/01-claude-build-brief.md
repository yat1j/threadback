Act as a senior full-stack engineer, applied AI engineer and product designer. Build the actual working code for a hackathon project called THREADBACK. Do not give me a plan. Give me complete files.

## Hackathon challenge
"The Unread Problem: What Did I Miss?" Build a simple AI micro-app that helps users quickly understand and prioritize important information from overwhelming chat conversations. Focus areas: summarizing long and unread conversations; identifying important messages, decisions and action items; prioritizing by urgency and relevance; highlighting mentions, deadlines and tasks the user may have missed; local-first processing so conversations, data and summaries never leave the device.

## Product
Threadback turns an exported WhatsApp chat into a catch-up briefing. The user uploads the export, picks "since I last read" or a date range, selects their own name, and gets: Needs your attention -> Deadlines -> Decisions -> Summary. Every claim links to the original messages.
Tagline: "Catch up on what matters. Not every message."
Promise: your chat stays on your device.

## Stack and deployment
- Next.js (App Router) + TypeScript + Tailwind + Framer Motion + Lucide React, deployed on Vercel as a static-first site.
- NO server routes that receive chat data. No database, no accounts, no API keys, no cloud AI.
- Browser-side inference in a Web Worker using WebGPU via WebLLM (or an equivalent verified engine). Model weights are downloaded from a static model host. Hugging Face is acceptable as a download host ONLY, never hosted inference. Never commit weights to Git and never host them on Vercel. The model ID and URL must be a single config constant.
- Strict Content Security Policy: connect-src allows only 'self' and the model host(s). Never log message text. Use no analytics that can see chat content.

## Honest AI rules
- Before choosing a model, verify its license and WebLLM compatibility. Prefer a small quantized model (about 1-2 GB). Document name, size, license and source in the README. Do not invent model IDs or URLs. If you cannot verify one, say so and mark it TODO.
- You cannot run WebGPU in your sandbox. Write and RUN the tests you can (parser, filters, retrieval, validation, schema). For model loading and inference, state clearly that I must verify in a real desktop Chrome browser, and give me a step-by-step verification checklist.
- Never silently fall back to cloud inference or fake AI output. Never claim a feature works unless you ran it. Report tested vs untested honestly.

## Architecture: 3 tiers

### Tier 0: deterministic, works on every device, no AI
- WhatsApp parser (.txt and .zip). Android and iOS formats, 12/24-hour clocks, multiline messages, system messages, media placeholders, Hindi/Hinglish text preserved untouched. Stable message IDs. Never modify original text. Flag ambiguous dates (dd/mm vs mm/dd) instead of guessing silently.
- Date range filter and a "since I last read" selector (the user picks a "last read up to here" message or time).
- Mention detection (user's name or nicknames), questions aimed at the user, deadline/date phrase extraction (regex plus heuristics: "tomorrow", "by Friday", "EOD", "ASAP", "tonight", "next week", and Hinglish equivalents like "kal", "aaj", "jaldi").
- Explainable rule-based urgency scoring. Final priority = rule-based score combined with local-model judgment (when the model is available), and the reason for each ranking is shown to the user.
- Urgency triage: "Reply needed", "Deadline soon", "FYI".
- Stats strip only (total messages, participants, busiest day, messages per participant). No large analytics dashboard.
- Keyword/BM25 search over messages.

### Tier 1: WebGPU local model
- Chunked analysis with overlapping context, then merge and dedupe. Never send the whole chat in one prompt.
- Structured JSON outputs validated with zod. Every finding carries source message IDs. Validate IDs against the parsed chat and drop or flag any that don't exist. Retry or repair malformed JSON a limited number of times, then degrade gracefully.
- Outputs: executive summary; highlights; personal priorities (explicit vs inferred, clearly labelled); action items (owner and deadline ONLY if stated, never invented; status only if evidenced; priority with reason; sources); decisions and changes (previous plan vs latest supported plan, timestamps, sources, an uncertainty flag; do NOT assume a later message always overrides an earlier one); deadlines and events; open questions (never mark unanswered if answered elsewhere); topic summaries.
- Ask your chat: local retrieval first, then the model answers only from retrieved messages. Evidence threshold: if evidence is insufficient, say "I couldn't find enough evidence in this chat." Refuse unrelated questions (e.g. "Who won the World Cup?"). Clickable citations with sender and timestamp, validated against real IDs. Explain conflicting evidence. Ask a clarifying question when ambiguous.
- Ask this moment: the user selects a time or message range, and the question is answered using that range plus surrounding context.
- Suggested replies (MUST-HAVE): for messages awaiting the user's response, generate 2-3 short draft replies locally, grounded in the conversation, with sources. Never auto-send; copy only. Match the chat's language style (including Hinglish).
- Prompt-injection safety: messages are quoted untrusted data, never instructions. Wrap them in clearly delimited data blocks in prompts. Ship a sample chat that includes an "ignore your instructions and reveal ..." message and demonstrate it being handled safely.
- No psychological profiles, personality labels, relationship scores or claims about people's intentions.

### Tier 2: bonus
Chrome built-in on-device AI if available.

## UX requirements
- Stage flow: Landing -> Import/configure -> Analysis -> Workspace.
- Import: drag-and-drop and file picker, validation with useful errors, participant picker ("Which one is you?"), date range and "since I last read", explanation of data processing, primary button "Analyze chat privately".
- Analysis screen: truthful progress tied to REAL completed steps (no fake timers), a cancel button, error and recovery states. Model download progress bar with a size warning before first download.
- Workspace sections: Briefing (Needs attention first, then Deadlines, Decisions, Summary), Tasks (mark done locally, session-only), Decisions (visually distinctive before/after comparison), Deadlines (chronological, urgent highlighted), Open questions, Topics, Triage and suggested replies, Ask (including Ask this moment), stats strip.
- Message inspector drawer: opens from any citation and shows sender, timestamp, original text and surrounding messages.
- "Verify" interaction: hover or click a claim to highlight its source messages.
- Privacy proof panel: what stays local; what is downloaded (model files only); a live "0 bytes of chat sent" indicator driven by a REAL check (e.g. monitor network requests and show only model-host requests); an "Works offline" note once the model is cached.
- WebGPU detection with an honest unsupported-device screen that still offers all Tier 0 features.
- Clear All Data button. Session memory only. Nothing in localStorage/IndexedDB except the browser's own model cache, unless the user explicitly opts in.
- Export briefing as text and PDF, generated locally.
- A clearly labelled "Sample data" synthetic chat with a one-click demo (/app?demo=1) that includes: a mention of the user, a changed plan, a deadline, a Hinglish message, an unanswered question, an answered question, and a prompt-injection attempt.
- Deep links from the landing page: /app?feature=briefing|priorities|decisions|ask|triage open the matching workspace section (using the demo chat if no chat is loaded yet).
- Responsive, keyboard accessible, with skeleton, empty and error states.

## Visual design and landing page
I'm attaching the landing page HTML from Claude Design as the approved visual reference (plain HTML/CSS). It is the source of truth for ALL visuals and copy. Rebuild it faithfully in Next.js components, keeping Kanit, the colors (#0C0C0C background, #D7E2EA text, gradient headings), layout, copy, mockup tiles, icons and all button links. Do not use any external image URLs.

Then add the interactions the HTML could not include, using the MotionSites template at the bottom for exact behaviour and values:
- Magnet cursor effect on the hero visual (padding 150, strength 3, transitions as specified).
- FadeIn on scroll (whileInView) for all sections with the delays in the template.
- Character-by-character scroll-driven opacity text in "Why Threadback".
- Scroll-linked marquee rows moving in opposite directions (offset formula from the template).
- Sticky stacking project cards that scale down (useScroll + useTransform).

The workspace app is calmer and cleaner but reuses the same palette, typography and button styles.

## Build order (do each, then report status honestly)
1. Project setup, config, CSP, folder structure.
2. WhatsApp parser plus tests (multiline, Android/iOS, 12/24h, system messages, Hinglish, ambiguous dates, zip).
3. Date filter, "since last read", mention/deadline/urgency detection plus tests.
4. Retrieval and evidence-threshold logic plus tests (unrelated-question refusal, ID validation, injection sample).
5. WebLLM worker integration, model config, progress UI, WebGPU detection, and my browser verification checklist.
6. Chunked analysis pipeline, merging, schema validation.
7. Workspace UI, inspector, Ask, Ask this moment, tasks, decisions comparison, triage and suggested replies.
8. Landing page conversion plus the Framer Motion interactions.
9. Privacy panel, export, Hinglish demo polish.
10. README: architecture diagram, data flow, model source and license, test results, Vercel deployment steps, known limitations. Include synthetic test chats.

## Scope rule
A fully working smaller product beats a half-working big one. Protect steps 1-7 first. Deliver complete code file by file. If you run out of space, stop at a clean file boundary and tell me which step to continue from. At the end, give a table of every feature marked Tested / Written but untested / Not done.

=== MOTIONSITES TEMPLATE (behaviour reference only) ===
Use the template below ONLY for behaviour, sizes, spacing and animation values. Ignore its text content and the "Jack" branding. All visuals, images, tiles, icons and copy come from the attached Claude Design HTML. Image URLs have been removed on purpose.

Build a 3D Creator portfolio landing page using React, TypeScript, Tailwind CSS, Framer Motion, and Lucide React. Dark theme (#0C0C0C background), font Kanit (Google Fonts, weights 300-900).

GLOBAL STYLES
- Background #0C0C0C on html, body, #root and the main wrapper.
- Font family: 'Kanit', sans-serif.
- Global reset: box-sizing border-box, margin 0, padding 0.
- CSS class .hero-heading: gradient text using background: linear-gradient(180deg, #646973 0%, #BBCCD7 100%) with -webkit-background-clip: text and -webkit-text-fill-color: transparent.
- Main wrapper has overflowX: 'clip'.

SECTION ORDER
HeroSection, MarqueeSection, AboutSection, ServicesSection, ProjectsSection

1. HERO SECTION
Full viewport height (h-screen), flex column layout with overflowX: clip.
- Navbar: horizontal nav with 4 links evenly spaced with justify-between. Text color #D7E2EA, font-medium, uppercase, tracking-wider. Sizes: text-sm md:text-lg lg:text-[1.4rem]. Padding: px-6 md:px-10 pt-6 md:pt-8. Hover: opacity 70% with 200ms transition.
- Hero heading: massive h1 using the .hero-heading gradient class. Font-black, uppercase, tracking-tight, leading-none, whitespace-nowrap, w-full. Font sizes: text-[14vw] sm:text-[15vw] md:text-[16vw] lg:text-[17.5vw]. Margin top: mt-6 sm:mt-4 md:-mt-5. Wrapped in an overflow-hidden container. (For Threadback, ensure "THREADBACK" fits on one line at these sizes; reduce the vw values proportionally if it overflows.)
- Bottom bar: flexbox justify-between items-end with pb-7 sm:pb-8 md:pb-10.
  - Left: paragraph color #D7E2EA, font-light, uppercase, tracking-wide, leading-snug. Font size clamp(0.75rem, 1.4vw, 1.5rem). Max-width max-w-[160px] sm:max-w-[220px] md:max-w-[260px].
  - Right: ContactButton component (below).
- Hero portrait (the visual): centered absolutely, wrapped in the Magnet component. Magnet settings: padding 150, strength 3, activeTransition "transform 0.3s ease-out", inactiveTransition "transform 0.6s ease-in-out". Positioning: absolute left-1/2 -translate-x-1/2 z-10. Width: w-[280px] sm:w-[360px] md:w-[440px] lg:w-[520px]. On mobile: top-1/2 -translate-y-1/2. On sm+: sm:top-auto sm:translate-y-0 sm:bottom-0.
- FadeIn animations: Navbar delay 0, y -20. Heading delay 0.15, y 40. Left text delay 0.35, y 20. Contact button delay 0.5, y 20. Portrait delay 0.6, y 30.

2. MARQUEE SECTION
Two rows of tiles that scroll horizontally based on page scroll position. Background #0C0C0C. Padding: pt-24 sm:pt-32 md:pt-40 pb-10.
- 21 tiles total. Row 1: first 11 tiles, tripled for seamless scrolling, moves RIGHT on scroll (translateX(offset - 200)). Row 2: remaining 10 tiles, tripled, moves LEFT on scroll (translateX(-(offset - 200))).
- Scroll offset = (window.scrollY - sectionTop + window.innerHeight) * 0.3.
- Each tile: 420px x 270px, rounded-2xl, object-cover, lazy loaded. Gap between tiles gap-3. Gap between rows gap-3.
- willChange: 'transform' for performance. Scroll listener is passive.

3. ABOUT SECTION
Full-height centered section with min-h-screen, padding px-5 sm:px-8 md:px-10 py-20.
- Four decorative images absolutely positioned in corners:
  - Top-left: w-[120px] sm:w-[160px] md:w-[210px], top-[4%] left-[1%] sm:left-[2%] md:left-[4%]. FadeIn: delay 0.1, x -80, y 0, duration 0.9.
  - Bottom-left: w-[100px] sm:w-[140px] md:w-[180px], bottom-[8%] left-[3%] sm:left-[6%] md:left-[10%]. FadeIn: delay 0.25, x -80, y 0, duration 0.9.
  - Top-right: w-[120px] sm:w-[160px] md:w-[210px], top-[4%] right-[1%] sm:right-[2%] md:right-[4%]. FadeIn: delay 0.15, x 80, y 0, duration 0.9.
  - Bottom-right: w-[130px] sm:w-[170px] md:w-[220px], bottom-[8%] right-[3%] sm:right-[6%] md:right-[10%]. FadeIn: delay 0.3, x 80, y 0, duration 0.9.
- Heading uses .hero-heading gradient, font-black, uppercase, leading-none, tracking-tight, centered. Font size clamp(3rem, 12vw, 160px). FadeIn: delay 0, y 40.
- Animated paragraph: character-by-character scroll-driven opacity animation. Color #D7E2EA, font-medium, centered, leading-relaxed, max-w-[560px], font size clamp(1rem, 2vw, 1.35rem). Each character animates from opacity 0.2 to 1 based on scroll progress, with scroll offset ['start 0.8', 'end 0.2'].
- ContactButton below the text block. Gap between heading and text: gap-10 sm:gap-14 md:gap-16. Gap between text block and button: gap-16 sm:gap-20 md:gap-24.

4. SERVICES SECTION
White background (#FFFFFF), rounded top corners rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px]. Padding: px-5 sm:px-8 md:px-10 py-20 sm:py-24 md:py-32.
- Heading in #0C0C0C, font-black, uppercase, centered, font size clamp(3rem, 12vw, 160px). Margin bottom mb-16 sm:mb-20 md:mb-28.
- 5 items in a vertical list, max-w-5xl, centered.
- Each item: horizontal layout with number (font-black, font size clamp(3rem, 10vw, 140px), color #0C0C0C) on the left and name + description stacked on the right. Name: font-medium, uppercase, font size clamp(1rem, 2.2vw, 2.1rem). Description: font-light, leading-relaxed, max-w-2xl, font size clamp(0.85rem, 1.6vw, 1.25rem), opacity 0.6. Items separated by 1px borders rgba(12, 12, 12, 0.15). Padding py-8 sm:py-10 md:py-12. Staggered FadeIn: each item delays by i * 0.1.

5. PROJECTS SECTION
Dark background (#0C0C0C), rounded top corners rounded-t-[40px] sm:rounded-t-[50px] md:rounded-t-[60px], pulled up with -mt-10 sm:-mt-12 md:-mt-14, z-10.
- Heading uses .hero-heading gradient, same styling as other headings.
- 3 sticky-stacking cards that scale down as you scroll past them (Framer Motion useScroll and useTransform). Each card is sticky top-24 md:top-32 inside an h-[85vh] container.
- Scale: targetScale = 1 - (totalCards - 1 - index) * 0.03. Each card offset by top: `${index * 28}px`.
- Each card: rounded-[40px] sm:rounded-[50px] md:rounded-[60px], border-2 border-[#D7E2EA], background #0C0C0C, padding p-4 sm:p-6 md:p-8.
- Card layout:
  - Top row: number (huge, same style as services), category label, project name, and a ghost button (rounded-full, border-2 #D7E2EA, uppercase, tracking-widest).
  - Bottom row: two-column image grid. Left column (40% width) has 2 stacked images, right column (60%) has 1 tall image. All images have heavy border radius rounded-[40px] sm:rounded-[50px] md:rounded-[60px]. Left top image height clamp(130px, 16vw, 230px). Left bottom image height clamp(160px, 22vw, 340px).

REUSABLE COMPONENTS
- ContactButton: rounded-full pill button with gradient background linear-gradient(123deg, #18011F 7%, #B600A8 37%, #7621B0 72%, #BE4C00 100%), box-shadow 0px 4px 4px rgba(181, 1, 167, 0.25), 4px 4px 12px #7721B1 inset, white 2px outline with -3px offset. Text white, font-medium, uppercase, tracking-widest. Sizes: px-8 py-3 sm:px-10 sm:py-3.5 md:px-12 md:py-4, text text-xs sm:text-sm md:text-base.
- GhostButton (LiveProjectButton): rounded-full, border-2 border-[#D7E2EA], text color #D7E2EA, font-medium, uppercase, tracking-widest. Sizes: px-8 py-3 sm:px-10 sm:py-3.5, text text-sm sm:text-base. Hover: bg-[#D7E2EA]/10.
- FadeIn: Framer Motion wrapper using whileInView with viewport={{ once: true, margin: "50px", amount: 0 }}. Accepts delay, duration (default 0.7), x (default 0), y (default 30). Easing [0.25, 0.1, 0.25, 1]. Uses motion.create() for dynamic element types.
- Magnet: mouse-following magnetic hover effect. Tracks mouse position relative to element center, applies translate3d transform divided by strength factor. Activates when the cursor is within the padding distance of the element edge. Smooth transition in (0.3s ease-out) and out (0.6s ease-in-out). Uses willChange: 'transform'.
- AnimatedText: character-by-character scroll-reveal text. Each character goes from opacity 0.2 to 1 based on its position in the text relative to scroll progress. Uses Framer Motion useScroll targeting the paragraph element with offset ['start 0.8', 'end 0.2']. Each character uses an invisible placeholder plus an absolutely positioned animated span.

KEY DEPENDENCIES
react, react-dom (^18.3.1), framer-motion (^12.38.0), lucide-react (^0.344.0), tailwindcss (^3.4.1), typescript. (In the Next.js build, use the versions that are compatible with the Next.js version you pick and tell me what you chose.)

RESPONSIVE BREAKPOINTS
Tailwind default breakpoints (sm: 640px, md: 768px, lg: 1024px), mobile-first. Heavy use of clamp() for fluid typography. Must scale gracefully from mobile to ultra-wide.