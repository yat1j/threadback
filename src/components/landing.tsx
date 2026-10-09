"use client";

import Link from "next/link";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, ShieldCheck, Sparkles, MessageCircle, CalendarClock, GitCompare, Search, CheckCircle2, LockKeyhole, Upload, HelpCircle, Download } from "lucide-react";
import { useRef, useState } from "react";

const rowOne = [
  ["Conversation overflow", "where r we meeting", "??", "pic of the cake lol", "@Asha sorry see above"],
  ["Mention highlight", "Team lunch Fri?", "@Asha can you book the table?", "on it"],
  ["Hinglish", "kal tak form bhej dena, warna late ho jayega", "haan, shaam tak bhejti hoon"],
  ["Plan keeps moving", "12:04 ok", "12:05 changed to 7pm", "12:09 no wait 8pm", "12:10 👍"],
  ["Shared media", "<Media omitted>", "Who has the invoice?", "Need it by Thursday", "<Media omitted>"],
  ["Unread", "1,000+", "…", "scroll scroll scroll"],
  ["Uncertainty", "so about the thing from last week, I think we should maybe consider possibly moving it but also not sure", "ok"],
  ["Reply buried", "Reply to: “can someone send the form”", "that was 3 days ago btw", "which form??"],
  ["Noise", "😂😂😂", "🔥", "🎤 Voice message 0:42", "👍"],
  ["Forwarded", "Forwarded: Fri 7pm at Café Nine", "Forwarded: Fri 7pm at Café Nine", "seen this 3 times"],
  ["Side conversation", "Meera: lol that meme", "Ravi: unrelated but who's driving", "I can't read all this"],
];
const rowTwo = [
  ["Action item · explicit", "Book the table", "Asked of you by Ravi · Fri", "Send invoice · inferred"],
  ["Deadline timeline", "Wed · Form due", "Thu · Invoice", "Sat · Event"],
  ["Decision change", "Before: Friday 7pm", "Latest: Saturday 8pm", "Unclear: venue not confirmed"],
  ["Evidence inspector", "“changed to 8pm” — Meera, 12:09", "Linked to 2 messages"],
  ["Ask your chat", "When is the event?", "Saturday 8pm [1][2]. Venue is not stated."],
  ["Triage", "Reply needed · 3", "Deadline soon · 2", "FYI · 14"],
  ["Privacy panel", "0 bytes", "of chat sent"],
  ["Suggested reply", "Yes, I'll confirm the venue by Thursday.", "Replying to Ravi, 12:09"],
  ["Topic summary", "Event plan · Saturday 8pm", "Invoice · Due Thursday"],
  ["Stats strip", "4 tasks", "2 deadlines", "1 change"],
];

function Tile({ item }: { item: string[] }) {
  const [label, ...lines] = item;
  return <div className="landing-tile"><span className="tile-label">SAMPLE DATA · {label}</span>{lines.map((line, i) => <div className={`tile-bubble ${i === lines.length - 1 ? "tile-me" : ""}`} key={line + i}>{line}</div>)}</div>;
}
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -60px 0px" }} transition={{ duration: 0.72, delay, ease: [0.25, 0.1, 0.25, 1] }}>{children}</motion.div>;
}
function MarqueeRow({ items, reverse = false, progress }: { items: string[][]; reverse?: boolean; progress: MotionValue<number> }) {
  const x = useTransform(progress, [0, 1], reverse ? [140, -260] : [-260, 140]);
  const copies = [...items, ...items, ...items];
  return <motion.div className="landing-marquee-row" style={{ x }}>{copies.map((item, i) => <Tile item={item} key={`${i}-${item[0]}`} />)}</motion.div>;
}
function MarqueeSection() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  return <section ref={ref} className="landing-marquee" aria-label="Sample conversation insights"><div className="marquee-caption"><span>MESSAGES IN THE WILD</span><span>SCROLL TO CONNECT THE DOTS <ArrowDownRight size={16} /></span></div><div className="marquee-clip"><MarqueeRow items={rowOne} progress={scrollYProgress} /><MarqueeRow items={rowTwo} reverse progress={scrollYProgress} /></div></section>;
}
function AnimatedText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.2"] });
  const characters = Array.from(text);
  return <p ref={ref} className="landing-reveal-copy" aria-label={text}>{characters.map((char, i) => <Character key={`${char}-${i}`} char={char} index={i} total={characters.length} progress={scrollYProgress} />)}</p>;
}
function Character({ char, index, total, progress }: { char: string; index: number; total: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [Math.max(0, index / total - 0.025), Math.min(1, index / total + 0.035)], [0.22, 1]);
  return <motion.span aria-hidden="true" style={{ opacity, whiteSpace: char === " " ? "pre" : undefined }}>{char}</motion.span>;
}
const features = [
  { n: "01", title: "Catch-up Briefing", copy: "Choose 'since I last read' or any date range and get what needs your attention first, then deadlines, decisions and a clear summary.", href: "briefing", icon: Sparkles },
  { n: "02", title: "Personal priorities", copy: "Find mentions, requests aimed at you and commitments you made. Explicit tasks stay separate from inferred ones.", href: "priorities", icon: MessageCircle },
  { n: "03", title: "Decisions and Changes", copy: "See the earlier plan next to the latest supported plan, with timestamps, sources and a flag where the chat is unclear.", href: "decisions", icon: GitCompare },
  { n: "04", title: "Ask Your Chat", copy: "Ask in plain language. Answers come only from your chat, cite the exact messages, and say so when there isn't enough evidence.", href: "ask", icon: Search },
  { n: "05", title: "Suggested Replies and Triage", copy: "Sort messages into Reply needed, Deadline soon and FYI, and get draft replies generated locally.", href: "triage", icon: CalendarClock },
];
const steps = [
  { n: "01", title: "Drop your export", copy: "Import a WhatsApp .txt or .zip export, select your name and pick the messages you want to catch up on." },
  { n: "02", title: "Analyzed on your device", copy: "The local model runs on your device. The first run downloads model files, not your chat." },
  { n: "03", title: "A briefing you can verify", copy: "Every AI finding points back to source messages, so you can check the evidence instead of trusting a black box." },
];
function StackedCard({ index, title, eyebrow, children }: { index: number; title: string; eyebrow: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1 - (2 - index) * 0.035]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -index * 3]);
  return <div ref={ref} className="stack-card-wrap"><motion.article className="stack-card" style={{ scale, y, top: `calc(92px + ${index * 22}px)` }}><div className="stack-card-head"><div><div className="stack-num">0{index + 1}</div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div><span className="stack-open">SAMPLE DATA <ArrowUpRight size={16}/></span></div>{children}</motion.article></div>;
}

export default function Landing() {
  const heroRef = useRef<HTMLDivElement>(null);
  const [magnet, setMagnet] = useState({ x: 0, y: 0 });
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.24], [0, -52]);
  return <main className="landing-page" id="top">
    <nav className="landing-nav"><a className="brand-mark" href="#top">THREADBACK<span>®</span></a><div><a href="#how">How it works</a><a href="#features">Features</a><a href="#privacy">Privacy</a><Link className="nav-try" href="/app">Try it <ArrowUpRight size={15}/></Link></div></nav>
    <header className="landing-hero" ref={heroRef}>
      <motion.div className="hero-head-wrap" style={{ y: heroY }}><h1 className="hero-heading landing-hero-title">THREADBACK</h1></motion.div>
      <div className="hero-orbit-position"><motion.div className="hero-orbit" initial={{ opacity: 0, scale: .94, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .8, delay: .2 }}>
        <div className="orbit-glow"/><div className="hero-chat-stack" onMouseMove={(e) => { const rect = e.currentTarget.parentElement?.getBoundingClientRect(); if (rect) setMagnet({ x: Math.max(-30, Math.min(30, (e.clientX - rect.left - rect.width / 2) / 3)), y: Math.max(-20, Math.min(20, (e.clientY - rect.top - rect.height / 2) / 3)) }); }} onMouseLeave={() => setMagnet({ x: 0, y: 0 })} style={{ transform: `translate3d(${magnet.x}px, ${magnet.y}px, 0) rotate(-2deg)` }}><div className="chat-line muted">anyone seen the venue email??</div><div className="chat-line right">lol which one</div><div className="chat-line muted">ok so Friday → Saturday now?</div><div className="hero-insight"><div className="insight-top"><span><Sparkles size={13}/> BRIEFING · SAMPLE DATA</span><span className="insight-live"><i/> INSIGHT FOUND</span></div><b>Needs you: confirm Saturday venue</b><p>Deadline Thu · 3 source messages</p><div className="insight-source"><span>Ravi · 12:11</span><span>Meera · 12:09</span><ArrowUpRight size={14}/></div></div></div>
        <div className="orbit-label label-a">01 / SIGNAL</div><div className="orbit-label label-b">02 / CONTEXT</div><div className="orbit-label label-c"><ShieldCheck size={14}/> DEVICE-LOCAL</div>
      </motion.div></div>
      <div className="hero-bottom"><div><p className="hero-tagline">Catch up on what matters.<br/>Not every message.</p><p className="hero-subline"><LockKeyhole size={14}/> Your chat stays on your device.</p></div><div className="hero-actions"><a className="pill ghost-pill" href="#how">Explore how it works <ArrowDownRight size={15}/></a><Link className="pill primary-pill" href="/app">Analyze your chat <ArrowUpRight size={15}/></Link><span className="hero-note">BEST ON DESKTOP CHROME OR EDGE</span></div></div>
    </header>
    <MarqueeSection />
    <section className="landing-about"><div className="about-decoration dec-one"><MessageCircle size={44}/></div><div className="about-decoration dec-two"><ShieldCheck size={42}/></div><Reveal><span className="eyebrow">THE UNREAD PROBLEM</span><h2 className="hero-heading">WHY THREADBACK</h2></Reveal><AnimatedText text="You come back to a group chat with a thousand unread messages. Threadback reads them on your device, finds what needs your attention, tracks deadlines and changed plans, and shows you the exact messages behind every answer. No account. No upload. No guesswork you can't verify."/><Reveal delay={.12}><Link className="pill primary-pill" href="/app">Analyze your chat <ArrowUpRight size={15}/></Link></Reveal></section>
    <section className="landing-features light-section" id="features"><div className="section-inner"><Reveal><span className="eyebrow dark-eyebrow">A BETTER WAY TO CATCH UP</span><h2 className="dark-title">Features<span>.</span></h2></Reveal>{features.map((feature, i) => {const Icon = feature.icon; return <Reveal key={feature.n} delay={i * .07}><div className="feature-row"><div className="feature-index">{feature.n}</div><div className="feature-icon"><Icon size={21}/></div><div className="feature-copy"><h3>{feature.title}</h3><p>{feature.copy}</p></div><Link className="feature-link" href={`/app?feature=${feature.href}`}>TRY IT <ArrowUpRight size={16}/></Link></div></Reveal>;})}</div></section>
    <section className="landing-how" id="how"><div className="section-inner"><Reveal><span className="eyebrow">THREE STEPS · ONE CLEAR BRIEFING</span><h2 className="hero-heading section-title">HOW IT WORKS</h2></Reveal><div className="how-grid">{steps.map((step, i) => <Reveal key={step.n} delay={i * .1}><article className="how-card"><div className="how-top"><span>{step.n}</span><span className="eyebrow">STEP {i + 1}</span></div><h3>{step.title}</h3><p>{step.copy}</p><div className="how-visual">{i === 0 ? <><div className="file-chip"><Upload size={17}/><span>_chat.txt</span><CheckCircle2 size={16}/></div><div className="date-chip">Since I last read <ArrowUpRight size={13}/></div></> : i === 1 ? <><div className="model-chip"><Sparkles size={17}/><span>Local analysis</span><span className="model-dot"/></div><div className="analysis-bars"><i/><i/><i/></div></> : <><div className="proof-chip"><ShieldCheck size={17}/><span>Evidence linked</span></div><div className="source-pills"><span>m0042</span><span>m0048</span></div></>}</div></article></Reveal>)}</div><div className="how-cta"><Link className="pill primary-pill" href="/app?demo=1">Try the sample demo <ArrowUpRight size={15}/></Link></div></div></section>
    <section className="landing-stack"><div className="section-inner"><Reveal><span className="eyebrow">A BRIEFING YOU CAN VERIFY</span><h2 className="hero-heading section-title">LESS NOISE.<br/>MORE SIGNAL.</h2></Reveal><StackedCard index={0} eyebrow="CATCH-UP BRIEFING" title="Know what matters first"><div className="stack-grid"><div className="stack-mini stack-lav"><span>NEEDS YOU</span><b>Confirm Saturday venue</b><small>Ravi · 12:11 · 2 sources</small></div><div className="stack-mini"><span>DEADLINE</span><b>Registration form</b><small>Today · Mentioned twice</small></div><div className="stack-mini"><span>OPEN QUESTION</span><b>Who is presenting?</b><small>Still unresolved</small></div></div></StackedCard><StackedCard index={1} eyebrow="DECISION DIFF" title="See what changed"><div className="decision-demo"><div><span>PREVIOUS PLAN</span><b>Friday · 7 PM</b><small>Message m0184</small></div><ArrowUpRight size={22}/><div className="decision-latest"><span>LATEST SUPPORTED</span><b>Saturday · 8 PM</b><small>Message m0191 · Final</small></div></div><div className="stack-foot"><ShieldCheck size={15}/> Sources checked · Venue still unconfirmed</div></StackedCard><StackedCard index={2} eyebrow="ASK YOUR CHAT" title="Ask. Verify. Move on."><div className="stack-qa"><div className="qa-question">When is the event?</div><div className="qa-answer">Saturday at 8 PM. The venue is not confirmed yet.<div className="qa-sources"><span>m0191 · Ravi</span><span>m0198 · Meera</span></div></div></div></StackedCard></div></section>
    <section className="landing-privacy light-section" id="privacy"><div className="section-inner"><Reveal><span className="eyebrow dark-eyebrow">PRIVACY IS A PRODUCT FEATURE</span><h2 className="dark-title">PRIVATE<br/>BY DESIGN<span>.</span></h2></Reveal><div className="privacy-grid"><Reveal><div className="privacy-card"><LockKeyhole size={22}/><h3>Stays on your device</h3><p>Your chat, your questions and your summaries. None of it is uploaded.</p></div></Reveal><Reveal delay={.08}><div className="privacy-card"><Download size={22}/><h3>Model files only</h3><p>Only the AI model files, cached by your browser. They never contain your chat.</p></div></Reveal><Reveal delay={.16}><div className="privacy-card"><HelpCircle size={22}/><h3>Honest limitations</h3><p>Local AI needs a compatible browser and enough device memory. Always inspect source messages.</p></div></Reveal></div><p className="privacy-footnote">Privacy claims should be verified in your browser's Network panel. Threadback is an independent project and is not affiliated with WhatsApp.</p></div></section>
    <section className="landing-final"><span className="eyebrow">YOUR NEXT CATCH-UP STARTS HERE</span><h2 className="hero-heading">WHAT DID<br/>YOU MISS?</h2><p>Built for the “What Did I Miss?” challenge.</p><div className="final-actions"><Link className="pill primary-pill" href="/app">Analyze your chat <ArrowUpRight size={15}/></Link><Link className="pill ghost-pill" href="/app?demo=1">Try with sample data <ArrowUpRight size={15}/></Link></div></section>
    <footer className="landing-footer"><div><a className="brand-mark" href="#top">THREADBACK<span>®</span></a><p>Catch up on what matters. Not every message.</p></div><div className="footer-links"><a href="#how">How it works</a><a href="#features">Features</a><a href="#privacy">Privacy</a><Link href="/app">Open app</Link></div><span className="footer-bottom">BUILT FOR THE “WHAT DID I MISS?” CHALLENGE · YOUR CHAT NEVER LEAVES YOUR DEVICE</span></footer>
  </main>;
}
