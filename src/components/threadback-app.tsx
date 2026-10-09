"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, CheckCircle2,
  ChevronDown, HelpCircle, Clipboard, Clock3, Download, FileArchive, FileText, Filter, GitCompare,
  LayoutDashboard, ListChecks, LockKeyhole, MessageCircle, PanelRightClose, Search,
  ShieldCheck, Sparkles, Upload, UserRound, X, Zap, Menu, RotateCcw, AlertTriangle, Send, ArrowUpRight,
} from "lucide-react";
import { SAMPLE_CHAT } from "@/data/sample";
import { MODEL } from "@/config/model";
import { readExport, parseChat, validateUpload } from "@/lib/parser";
import { filterByRange, sinceLastRead, computeStats } from "@/lib/filter";
import { getDateBounds, timestampFromDateInput, timestampFromDateTimeInput } from "@/lib/date-range";
import { computeSignals, type Signals } from "@/lib/detect";
import { Bm25Index, indexFor, retrieve, INSUFFICIENT } from "@/lib/retrieval";
import { analyzeChat, askChat, suggestReplies, type AnalysisResult, type LLM, type ProgressEvent, type Answer } from "@/lib/pipeline";
import { emptyGrounded, type Grounded } from "@/lib/schema";
import { detectWebGpu, type GpuStatus } from "@/lib/webgpu";
import { createLocalLLM, isModelCached, type LoadProgress } from "@/lib/engine";
import { chatSentIsZero, patchFetch, summarize, type NetEvent, type NetSummary } from "@/lib/network-monitor";
import { sinceTime } from "@/lib/filter";
import type { DateOrder, Message, ParsedChat } from "@/lib/types";

type Stage = "import" | "analysis" | "workspace";
type Section = "briefing" | "priorities" | "decisions" | "deadlines" | "tasks" | "questions" | "topics" | "triage" | "ask" | "stats" | "privacy";
const NAV: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "briefing", label: "Briefing", icon: LayoutDashboard },
  { id: "priorities", label: "Your priorities", icon: Zap },
  { id: "decisions", label: "Decisions & changes", icon: GitCompare },
  { id: "deadlines", label: "Deadlines", icon: CalendarClock },
  { id: "tasks", label: "Action items", icon: ListChecks },
  { id: "questions", label: "Open questions", icon: HelpCircle },
  { id: "topics", label: "Topics", icon: BookOpen },
  { id: "triage", label: "Message triage", icon: Filter },
  { id: "ask", label: "Ask your chat", icon: MessageCircle },
  { id: "stats", label: "Chat stats", icon: Activity },
  { id: "privacy", label: "Privacy & data", icon: ShieldCheck },
];
const SECTION_BY_FEATURE: Record<string, Section> = { briefing: "briefing", priorities: "priorities", decisions: "decisions", ask: "ask", triage: "triage" };
// Parser timestamps intentionally encode the wall-clock values in the export as UTC components.
// Keep display formatting in UTC too, otherwise local timezones shift dates/times away from the chat.
const formatDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const formatDateTime = (ts: number) => new Date(ts).toLocaleString(undefined, { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const getInitials = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

function dateTimeInput(ts: number) {
  // `datetime-local` represents a wall-clock value; parser timestamps use UTC to preserve
  // the wall-clock components from WhatsApp, so do not apply the PC's timezone offset.
  return new Date(ts).toISOString().slice(0, 16);
}
function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "purple" }) {
  return <span className={`tb-pill tb-pill-${tone}`}>{children}</span>;
}
function SourceButton({ id, message, onClick }: { id: string; message?: Message; onClick: (id: string) => void }) {
  if (!message) return null;
  return <button className="tb-source-chip" onClick={() => onClick(id)} title="Open source message"><span className="source-dot"/>{message.sender ?? "System"} · {formatDateTime(message.ts)} <ArrowRight size={12}/></button>;
}
function EmptyState({ icon: Icon = HelpCircle, title, text, action }: { icon?: typeof HelpCircle; title: string; text: string; action?: React.ReactNode }) {
  return <div className="tb-empty"><span className="tb-empty-icon"><Icon size={22}/></span><b>{title}</b><p>{text}</p>{action}</div>;
}
function SectionHeader({ eyebrow, title, copy, right }: { eyebrow: string; title: string; copy?: string; right?: React.ReactNode }) {
  return <div className="tb-section-header"><div><div className="tb-eyebrow">{eyebrow}</div><h1>{title}</h1>{copy && <p>{copy}</p>}</div>{right}</div>;
}

export default function ThreadbackApp() {
  const [stage, setStage] = useState<Stage>("import");
  const [parsed, setParsed] = useState<ParsedChat | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [dateOrderChoice, setDateOrderChoice] = useState<DateOrder>("dmy");
  const [dateOrderWasAmbiguous, setDateOrderWasAmbiguous] = useState(false);
  const [dateOrderConfirmed, setDateOrderConfirmed] = useState(true);
  const [fileName, setFileName] = useState("");
  const [userName, setUserName] = useState("");
  const [nicknames, setNicknames] = useState("");
  const [rangeMode, setRangeMode] = useState<"range" | "since-message" | "since-time">("range");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [lastReadId, setLastReadId] = useState("");
  const [lastReadTime, setLastReadTime] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("briefing");
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [ai, setAi] = useState<LLM & { dispose(): Promise<void> } | null>(null);
  const aiRef = useRef<(LLM & { dispose(): Promise<void> }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [progress, setProgress] = useState<LoadProgress>({ progress: 0, text: "Preparing local model…" });
  const [pipelineProgress, setPipelineProgress] = useState<ProgressEvent | null>(null);
  const [showModelWarning, setShowModelWarning] = useState(false);
  const [modelCached, setModelCached] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askMomentId, setAskMomentId] = useState("");
  const [askMoment, setAskMoment] = useState(false);
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<{ text: string; sources: string[] }[]>([]);
  const [replyLoadingId, setReplyLoadingId] = useState<string | null>(null);
  const [netEvents, setNetEvents] = useState<NetEvent[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const didReadQuery = useRef(false);
  const pendingSelectionRef = useRef<Message[]>([]);

  useEffect(() => {
    detectWebGpu().then(setGpuStatus);
    isModelCached().then(setModelCached);
    const restore = (e: NetEvent) => setNetEvents((old) => [...old.slice(-199), e]);
    const unpatch = patchFetch(window, restore);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("threadback-net");
      channel.onmessage = (e) => restore(e.data as NetEvent);
    } catch { /* BroadcastChannel may be unavailable in a constrained browser. */ }
    return () => { unpatch(); channel?.close(); };
  }, []);

  useEffect(() => {
    if (didReadQuery.current) return;
    didReadQuery.current = true;
    const params = new URLSearchParams(window.location.search);
    const demo = params.get("demo") === "1";
    const feature = params.get("feature");
    if (!demo && !feature) return;
    const p = parseChat(SAMPLE_CHAT);
    setParsed(p); setSourceText(SAMPLE_CHAT); setDateOrderChoice(p.dateOrder); setDateOrderWasAmbiguous(false); setDateOrderConfirmed(true);
    setFileName("threadback-sample-chat.txt"); setUserName("Asha"); setIsDemo(true);
    const bounds = getDateBounds(p.messages);
    setFromDate(bounds.from); setToDate(bounds.to);
    setLastReadId(p.messages[0]?.id ?? "");
    const demoBounds = getDateBounds(p.messages);
    setLastReadTime(demoBounds.minTs !== undefined ? dateTimeInput(demoBounds.minTs - 60_000) : "");
    setMessages(p.messages); setStage("workspace");
    if (feature && SECTION_BY_FEATURE[feature]) setActiveSection(SECTION_BY_FEATURE[feature]);
  }, []);

  useEffect(() => { aiRef.current = ai; }, [ai]);
  useEffect(() => () => { abortRef.current?.abort(); if (aiRef.current) void aiRef.current.dispose(); }, []);

  const currentById = useMemo(() => new Map((parsed?.messages ?? []).map((m) => [m.id, m])), [parsed]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const grounded: Grounded | null = analysis?.grounded ?? null;
  const stats = useMemo(() => computeStats(messages), [messages]);
  const signals: Signals[] = useMemo(() => messages.length && userName.trim() ? computeSignals(parsed?.messages ?? messages, messages, { name: userName, nicknames: nicknames.split(",").map((s) => s.trim()).filter(Boolean) }) : [], [parsed, messages, userName, nicknames]);
  const signalById = useMemo(() => new Map(signals.map((s) => [s.id, s])), [signals]);
  const inspectorMessage = inspectorId ? currentById.get(inspectorId) ?? messageById.get(inspectorId) : null;
  const inspectorIndex = inspectorMessage ? (parsed?.messages ?? messages).findIndex((m) => m.id === inspectorMessage.id) : -1;
  const inspectorContext = inspectorMessage ? (parsed?.messages ?? messages).slice(Math.max(0, inspectorIndex - 2), Math.min((parsed?.messages ?? messages).length, inspectorIndex + 3)) : [];
  const netSummary: NetSummary = useMemo(() => summarize(netEvents), [netEvents]);
  const privacyOkay = chatSentIsZero(netSummary);
  const triageGroups = useMemo(() => ({
    reply: messages.filter((m) => signalById.get(m.id)?.triage === "reply"),
    deadline: messages.filter((m) => signalById.get(m.id)?.triage === "deadline"),
    fyi: messages.filter((m) => signalById.get(m.id)?.triage === "fyi"),
  }), [messages, signalById]);
  const selectedRangeMessages = useCallback(() => {
    if (!parsed) return [];
    if (rangeMode === "since-message" && lastReadId) return sinceLastRead(parsed.messages, lastReadId);
    if (rangeMode === "since-time" && lastReadTime) {
      const cutoff = timestampFromDateTimeInput(lastReadTime);
      return cutoff === undefined ? [] : sinceTime(parsed.messages, cutoff);
    }
    const from = timestampFromDateInput(fromDate); const to = timestampFromDateInput(toDate, true);
    return filterByRange(parsed.messages, { from, to });
  }, [parsed, rangeMode, lastReadId, lastReadTime, fromDate, toDate]);
  const selectedMessageCount = useMemo(() => {
    try { return selectedRangeMessages().length; } catch { return 0; }
  }, [selectedRangeMessages]);
  const lastReadOptions = useMemo(() => {
    if (!parsed) return [];
    const all = parsed.messages;
    const base = all.length <= 100 ? all : [all[0], ...all.slice(-99)];
    const selected = all.find((m) => m.id === lastReadId);
    const unique = new Map([...base, ...(selected ? [selected] : [])].map((m) => [m.id, m]));
    return [...unique.values()].sort((a, b) => a.idx - b.idx);
  }, [parsed, lastReadId]);
  const alternateDateOrder: DateOrder = dateOrderChoice === "dmy" ? "mdy" : "dmy";
  const alternateRangeMatchCount = useMemo(() => {
    if (!parsed || !sourceText || rangeMode !== "range" || selectedMessageCount !== 0 || !fromDate || !toDate) return 0;
    try {
      const alternate = parseChat(sourceText, { dateOrder: alternateDateOrder });
      return filterByRange(alternate.messages, { from: timestampFromDateInput(fromDate), to: timestampFromDateInput(toDate, true) }).length;
    } catch { return 0; }
  }, [parsed, sourceText, rangeMode, selectedMessageCount, fromDate, toDate, alternateDateOrder]);
  const parsedBounds = useMemo(() => getDateBounds(parsed?.messages ?? []), [parsed]);

  function changeDateOrder(order: DateOrder, preserveSelectedRange = false) {
    if (!sourceText) return;
    const oldBounds = parsed ? getDateBounds(parsed.messages) : { from: "", to: "" };
    const hadManualRange = !!fromDate && !!toDate && (fromDate !== oldBounds.from || toDate !== oldBounds.to);
    const keepRange = preserveSelectedRange || hadManualRange;
    const oldFrom = fromDate; const oldTo = toDate;
    const result = parseChat(sourceText, { dateOrder: order });
    setDateOrderChoice(order);
    setParsed(result);
    setDateOrderWasAmbiguous(result.dateAmbiguous);
    setDateOrderConfirmed(true);
    setUploadError(""); setAnalysisError(""); setAnalysis(null); setMessages([]);
    const bounds = getDateBounds(result.messages);
    if (keepRange) { setFromDate(oldFrom); setToDate(oldTo); }
    else { setFromDate(bounds.from); setToDate(bounds.to); }
    // The default must mean “catch up on almost everything”, not silently only the last 5 messages.
    setLastReadId(result.messages[0]?.id ?? "");
    setLastReadTime(bounds.minTs !== undefined ? dateTimeInput(bounds.minTs - 60_000) : "");
    setRangeMode("range");
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setUploadError("");
    const issue = validateUpload(file);
    if (issue) { setUploadError(issue); return; }
    try {
      const text = await readExport(file);
      const result = parseChat(text);
      if (!result.messages.length) { setUploadError(result.warnings[0] ?? "No chat messages were found."); return; }
      setSourceText(text); setParsed(result); setDateOrderChoice(result.dateOrder); setDateOrderWasAmbiguous(result.dateAmbiguous); setDateOrderConfirmed(!result.dateAmbiguous);
      setFileName(file.name); setIsDemo(false); setAnalysis(null); setAnalysisError(""); const old = aiRef.current; aiRef.current = null; setAi(null); if (old) void old.dispose(); setMessages([]);
      setUserName(result.participants[0] ?? "");
      const bounds = getDateBounds(result.messages);
      setFromDate(bounds.from); setToDate(bounds.to);
      // Do not default “since I last read” to the 6th-from-last message (which silently
      // selects only five messages). Start at the beginning; the user can move the marker.
      setLastReadId(result.messages[0]?.id ?? "");
      setLastReadTime(bounds.minTs !== undefined ? dateTimeInput(bounds.minTs - 60_000) : "");
      setRangeMode("range"); setStage("import");
    } catch (e) { setUploadError(e instanceof Error ? e.message : "Could not read this export."); }
  }

  function resetToImport() {
    abortRef.current?.abort();
    const oldAi = aiRef.current; aiRef.current = null; setAi(null); if (oldAi) void oldAi.dispose();
    setParsed(null); setSourceText(""); setDateOrderChoice("dmy"); setDateOrderWasAmbiguous(false); setDateOrderConfirmed(true); setFileName(""); setUserName(""); setNicknames(""); setMessages([]); setAnalysis(null); setAnalysisError(""); setUploadError(""); setIsDemo(false); setDoneTasks(new Set()); setAnswer(null); setQuestion(""); setReplyDrafts([]); setReplyTarget(null); setAskMoment(false); setAskMomentId(""); setInspectorId(null); setActiveSection("briefing"); setFromDate(""); setToDate(""); setLastReadId(""); setLastReadTime(""); setRangeMode("range"); setNetEvents([]); setStage("import"); setClearConfirm(false);
    if (typeof window !== "undefined") window.history.replaceState(null, "", "/app");
  }

  async function beginAnalysis() {
    if (!parsed) return;
    let selection: Message[];
    try { selection = selectedRangeMessages(); } catch (e) { setUploadError(e instanceof Error ? e.message : "Could not apply that range."); return; }
    if (!selection.length) { setUploadError("There are no messages in that selection. Try a wider date range or an earlier last-read point."); return; }
    pendingSelectionRef.current = selection;
    setMessages(selection); setAnalysis(null); setAnalysisError(""); setShowModelWarning(false);
    const gpu = gpuStatus ?? await detectWebGpu(); setGpuStatus(gpu);
    if (!gpu.supported) { setAnalysisError(`Local AI is unavailable on this device: ${gpu.reason} The deterministic features still work.`); setStage("workspace"); setActiveSection("briefing"); return; }
    if (!modelCached && !aiRef.current) { setShowModelWarning(true); return; }
    await executeAnalysis(selection);
  }

  async function executeAnalysis(selection = pendingSelectionRef.current.length ? pendingSelectionRef.current : messages) {
    if (!selection.length) {
      setShowModelWarning(false);
      setAnalysisError("No messages are selected. Recheck the date range and try again.");
      setStage("import");
      return;
    }
    pendingSelectionRef.current = selection;
    cancelRequested.current = false;
    const controller = new AbortController(); abortRef.current = controller;
    setStage("analysis"); setProgress({ progress: 0, text: "Starting local model…" }); setPipelineProgress(null); setAnalysisError("");
    let local = aiRef.current;
    try {
      if (!local) {
        local = await createLocalLLM((p) => setProgress(p));
        if (cancelRequested.current) { await local.dispose(); setStage("import"); return; }
        aiRef.current = local; setAi(local); setModelCached(true);
      }
      const result = await analyzeChat(local, selection, userName, (p) => setPipelineProgress(p), controller.signal);
      setAnalysis(result); setActiveSection("briefing"); setStage("workspace");
      pendingSelectionRef.current = [];
      if (result.failedChunks.length) setAnalysisError(`${result.failedChunks.length} section(s) could not be analyzed reliably. Findings without validated source messages were omitted.`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || cancelRequested.current) { setStage("workspace"); setAnalysisError("Analysis cancelled. Your imported chat remains in this browser session."); }
      else { setStage("workspace"); setAnalysisError(e instanceof Error ? `${e.message} The rule-based tools remain available; no cloud fallback was used.` : "Local model failed to load. Rule-based tools remain available; no cloud fallback was used."); }
    } finally { abortRef.current = null; }
  }

  function cancelAnalysis() { cancelRequested.current = true; abortRef.current?.abort(); }

  async function runAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !messages.length) return;
    setAskLoading(true); setAnswer(null);
    try {
      let target = messages;
      if (askMoment) {
        const selectedIndex = Math.max(0, messages.findIndex((m) => m.id === askMomentId));
        target = messages.slice(Math.max(0, selectedIndex - 8), Math.min(messages.length, selectedIndex + 9));
      }
      const index = indexFor(target);
      const ev = retrieve(index, question);
      if (ev.status === "insufficient") { setAnswer({ text: INSUFFICIENT, sources: [], droppedRefs: [], status: "insufficient", conflicting: [] }); return; }
      if (ev.status === "clarify") { setAnswer({ text: ev.message, sources: [], droppedRefs: [], status: "clarify", conflicting: [] }); return; }
      if (!aiRef.current) {
        setAnswer({ text: "Relevant messages were found, but the local model has not been loaded yet. Load the local AI model to generate a grounded answer. No chat was sent anywhere.", sources: ev.hits.map((h) => h.msg.id), droppedRefs: [], status: "clarify", conflicting: ev.conflicting }); return;
      }
      setAnswer(await askChat(aiRef.current, index, question, userName));
    } catch (e) { setAnswer({ text: e instanceof Error ? e.message : INSUFFICIENT, sources: [], droppedRefs: [], status: "uncited", conflicting: [] }); }
    finally { setAskLoading(false); }
  }

  async function makeReplies(message: Message) {
    setReplyTarget(message.id); setReplyLoadingId(message.id); setReplyDrafts([]);
    try {
      if (!aiRef.current) { setAnalysisError("Load the local model first to draft replies on this device."); setReplyTarget(message.id); return; }
      const r = await suggestReplies(aiRef.current, parsed?.messages ?? messages, message, userName);
      setReplyDrafts(r); setReplyTarget(message.id);
    } catch { setReplyDrafts([]); setReplyTarget(message.id); }
    finally { setReplyLoadingId(null); }
  }

  function exportBriefing() {
    const lines = ["THREADBACK — Catch up on what matters. Not every message.", `Source: ${fileName || "sample data"}`, `Messages analyzed: ${messages.length}`, "", "SUMMARY", grounded?.summary || "Local AI summary has not been generated.", "", "NEEDS YOUR ATTENTION", ...triageGroups.reply.slice(0, 20).map((m) => `- ${m.sender}: ${m.text} (${formatDateTime(m.ts)})`), "", "DEADLINES", ...((grounded?.deadlines ?? []).map((d) => `- ${d.what}: ${d.when} [${d.sources.join(", ")}]`)), "", "DECISIONS", ...((grounded?.decisions ?? []).map((d) => `- ${d.topic}: ${d.previous ? `${d.previous} -> ` : ""}${d.latest}${d.uncertain ? " (uncertain)" : ""} [${d.sources.join(", ")}]`)), "", "Generated locally by Threadback. Check source messages before relying on AI conclusions."];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "threadback-briefing.txt"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toggleTask(task: string) { setDoneTasks((old) => { const next = new Set(old); next.has(task) ? next.delete(task) : next.add(task); return next; }); }

  function goWorkspaceSection(section: Section) { setActiveSection(section); setMobileNavOpen(false); }

  async function beginWorkspaceAI() {
    if (!messages.length) return;
    const gpu = gpuStatus ?? await detectWebGpu();
    setGpuStatus(gpu);
    if (!gpu.supported) {
      setAnalysisError(`Local AI is unavailable on this device: ${gpu.reason} Basic priorities, date filtering, search, and statistics remain available.`);
      return;
    }
    if (!modelLoaded && !modelCached) { setShowModelWarning(true); return; }
    await executeAnalysis(messages);
  }

  const section = activeSection;
  const modelLoaded = !!aiRef.current;
  const basicPriorityMessages = messages.filter((m) => { const s = signalById.get(m.id); return !!s && (s.score >= 25 || s.triage !== "fyi"); }).sort((a, b) => (signalById.get(b.id)?.score ?? 0) - (signalById.get(a.id)?.score ?? 0));
  const allTasks = grounded?.actions ?? [];
  const allDeadlines = grounded?.deadlines ?? [];
  const allDecisions = grounded?.decisions ?? [];
  const allTopics = grounded?.topics ?? [];
  const openQuestions = (grounded?.questions ?? []).filter((q) => !q.answered);
  const userSignals = signals.filter((s) => s.mention || s.directQuestion || s.request || s.deadlines.length > 0);

  return <div className="threadback-app">
    {stage === "import" && <div className="tb-import-wrap">
      <header className="tb-app-topbar"><a href="/" className="tb-brand">THREADBACK<span>®</span></a><div className="tb-top-actions"><span className="tb-local-label"><LockKeyhole size={14}/> LOCAL-FIRST</span><a href="/#features" className="tb-back-link"><ArrowLeft size={14}/> About Threadback</a></div></header>
      <div className="tb-import-main">
        <div className="tb-import-intro"><span className="tb-eyebrow"><Sparkles size={13}/> YOUR PERSONAL CATCH-UP</span><h1>Catch up on<br/><span>what matters.</span></h1><p>Bring the conversation. Leave the noise behind. Your chat is processed in this browser session.</p></div>
        {isDemo && parsed ? <div className="tb-sample-banner"><div className="tb-sample-icon"><Sparkles size={19}/></div><div><b>Sample conversation loaded</b><p>A synthetic group chat with changed plans, deadlines, a Hinglish request and an instruction-injection example. No private chat is needed to explore Threadback.</p></div><button className="tb-text-button" onClick={() => { setIsDemo(false); setParsed(null); setSourceText(""); setMessages([]); setFileName(""); setDateOrderWasAmbiguous(false); }}>Use my own export</button></div> : <div className={`tb-dropzone ${dragging ? "is-dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files[0]); }}>
          <input ref={fileInputRef} type="file" accept=".txt,.zip,text/plain,application/zip" hidden onChange={(e) => { void handleFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
          <div className="tb-upload-icon"><FileArchive size={27}/></div><h2>Drop your WhatsApp export</h2><p>TXT or ZIP · up to 60 MB · exports with or without media</p><button className="tb-button tb-button-primary" onClick={() => fileInputRef.current?.click()}><Upload size={16}/> Choose a file</button><span className="tb-drop-foot">Your file is parsed in memory in this browser. It is not uploaded.</span>
        </div>}
        {uploadError && <div className="tb-error"><AlertCircle size={17}/><span>{uploadError}</span></div>}
        {parsed && <section className="tb-config-card">
          <div className="tb-card-heading"><div><span className="tb-eyebrow">IMPORT CONFIGURATION</span><h2>{fileName || "WhatsApp export"}</h2><p>{parsed.messages.length.toLocaleString()} messages · {parsed.participants.length} participants</p></div><button className="tb-icon-button" aria-label="Remove file" onClick={() => { setParsed(null); setSourceText(""); setMessages([]); setFileName(""); setIsDemo(false); setDateOrderWasAmbiguous(false); }}><X size={17}/></button></div>
          {parsed.warnings.map((warning, i) => <div key={i} className="tb-warning-line"><AlertTriangle size={15}/>{warning}</div>)}
          {parsed && sourceText && <div className="tb-date-order-card"><label className="tb-field"><span><CalendarClock size={14}/> Interpret dates in this export as</span><select value={dateOrderChoice} onChange={(e) => changeDateOrder(e.target.value as DateOrder)}><option value="dmy">Day / month / year (DD/MM/YYYY)</option><option value="mdy">Month / day / year (MM/DD/YYYY)</option></select></label><small>{dateOrderWasAmbiguous || !dateOrderConfirmed ? "The export contains dates that can be interpreted more than one way. Compare the detected span below with WhatsApp and choose the matching format." : `Current interpretation: ${dateOrderChoice === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"}. You can override it if the displayed span does not match your export.`}</small><small>Detected conversation span: {parsedBounds.from || "unknown"} to {parsedBounds.to || "unknown"}. These dates are derived from the parsed message timestamps.</small></div>}
          <div className="tb-form-grid"><label className="tb-field"><span><UserRound size={14}/> Which one is you?</span><select value={userName} onChange={(e) => setUserName(e.target.value)}>{parsed.participants.map((p) => <option key={p} value={p}>{p}</option>)}</select></label><label className="tb-field"><span>Nicknames (optional)</span><input value={nicknames} onChange={(e) => setNicknames(e.target.value)} placeholder="e.g. Ash, Ashu"/></label></div>
          <div className="tb-range-label"><span className="tb-eyebrow">WHAT DO YOU NEED TO CATCH UP ON?</span><div className="tb-range-options"><button className={rangeMode === "range" ? "selected" : ""} onClick={() => setRangeMode("range")}><CalendarClock size={16}/> Date range</button><button className={rangeMode === "since-message" ? "selected" : ""} onClick={() => setRangeMode("since-message")}><MessageCircle size={16}/> Since I last read</button><button className={rangeMode === "since-time" ? "selected" : ""} onClick={() => setRangeMode("since-time")}><Clock3 size={16}/> Since a time</button></div></div>
          {rangeMode === "range" ? <div className="tb-form-grid"><label className="tb-field"><span>From</span><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}/></label><label className="tb-field"><span>To</span><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}/></label></div> : rangeMode === "since-message" ? <label className="tb-field"><span>Last message you remember reading</span><select value={lastReadId} onChange={(e) => setLastReadId(e.target.value)}>{lastReadOptions.map((m) => <option key={m.id} value={m.id}>{formatDateTime(m.ts)} · {(m.sender ?? "System")}: {m.text.slice(0, 85) || "[no text]"}</option>)}</select><small>The selected message is treated as the last one you already read. By default, Threadback starts at the beginning so it does not silently limit you to just a few recent messages.</small></label> : <label className="tb-field"><span>I last caught up at</span><input type="datetime-local" value={lastReadTime} onChange={(e) => setLastReadTime(e.target.value)}/><small>Only messages later than this time are included. The default is one minute before the earliest message.</small></label>}
          <div className={`tb-range-count ${selectedMessageCount === 0 ? "is-empty" : ""}`}><span>{selectedMessageCount.toLocaleString()} messages match the current selection (of {parsed.messages.length.toLocaleString()} parsed)</span>{selectedMessageCount === 0 && <><small>{fromDate && toDate && fromDate > toDate ? "The From date is after the To date. Correct the range." : "No messages matched this selection. The parsed dates above may use the wrong date order, or the selected range may be outside the export."}</small><div className="tb-inline-actions"><button type="button" className="tb-text-button" onClick={() => changeDateOrder(alternateDateOrder, true)}>Try {alternateDateOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"} interpretation{alternateRangeMatchCount ? ` (${alternateRangeMatchCount} messages match)` : ""}</button><button type="button" className="tb-text-button" onClick={() => { const b = getDateBounds(parsed.messages); setFromDate(b.from); setToDate(b.to); setRangeMode("range"); setUploadError(""); }}>Use full conversation range</button></div></>}</div>
          <div className="tb-import-privacy"><ShieldCheck size={19}/><div><b>Private by design</b><p>Raw chat and results stay in session memory. The optional local model downloads model files only; it never receives chat data through a network request.</p></div></div>
          <button className="tb-button tb-button-primary tb-button-wide" onClick={() => { void beginAnalysis(); }}><Sparkles size={17}/> Analyze chat privately <ArrowRight size={16}/></button>
        </section>}
        {!parsed && !isDemo && <div className="tb-how-small"><div><span>01</span><b>Import a chat</b><p>Export from WhatsApp and choose the file.</p></div><div><span>02</span><b>Analyze privately</b><p>Rule-based signals work without AI.</p></div><div><span>03</span><b>Verify the briefing</b><p>Open sources behind each finding.</p></div></div>}
        <div className="tb-footer-note"><ShieldCheck size={14}/> No account · No chat upload · No cloud AI fallback</div>
      </div>
    </div>}

    {stage === "analysis" && <div className="tb-processing-page"><div className="tb-processing-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core"><Sparkles size={29}/></div></div><span className="tb-eyebrow">THREADBACK · ON-DEVICE ANALYSIS</span><h1>{progress.progress > 0 ? "Preparing your briefing." : "Finding the signal."}</h1><p className="tb-processing-sub">Your messages stay in this browser. No cloud model is used.</p><div className="tb-progress-card"><div className="tb-progress-title"><span>{pipelineProgress?.label ?? progress.text ?? "Preparing local model…"}</span><span>{Math.round((pipelineProgress ? pipelineProgress.done / Math.max(1, pipelineProgress.total) : progress.progress) * 100)}%</span></div><div className="tb-progress-track"><div style={{ width: `${(pipelineProgress ? pipelineProgress.done / Math.max(1, pipelineProgress.total) : progress.progress) * 100}%` }}/></div><div className="tb-stage-list"><div className="done"><Check size={14}/> Chat parsed in memory</div><div className={progress.progress > 0 || modelLoaded ? "done" : "active"}>{modelLoaded ? <Check size={14}/> : <span className="tb-stage-spinner"/>} Load local language model</div><div className={pipelineProgress ? "active" : "pending"}>{pipelineProgress ? <span className="tb-stage-spinner"/> : <span className="tb-stage-empty"/>} Analyze chunks and validate source IDs</div><div className="pending"><span className="tb-stage-empty"/> Merge findings into your briefing</div></div><div className="tb-size-note"><Download size={14}/> First run may download about {MODEL.approxDownloadMB} MB (estimate). Model files only — never the chat.</div></div><button className="tb-button tb-button-quiet" onClick={cancelAnalysis}><X size={15}/> Cancel analysis</button><p className="tb-small-note">If local AI fails, Threadback will explain the issue and keep the deterministic tools available. It will not upload your chat.</p></div>}

    {stage === "workspace" && <div className="tb-workspace-shell">
      <aside className={`tb-sidebar ${mobileNavOpen ? "open" : ""}`}><div className="tb-sidebar-brand"><a href="/" className="tb-brand">THREADBACK<span>®</span></a><button className="tb-icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18}/></button></div><div className="tb-chat-meta"><div className="tb-chat-avatar">{isDemo ? "S" : getInitials(userName || "C")}</div><div><b>{isDemo ? "Sample conversation" : fileName || "Imported chat"}</b><span>{messages.length.toLocaleString()} messages in range</span></div><Pill tone={isDemo ? "purple" : "green"}>{isDemo ? "SAMPLE" : "LOCAL"}</Pill></div><div className="tb-nav-label">YOUR WORKSPACE</div><nav className="tb-sidebar-nav">{NAV.map((item) => {const Icon = item.icon; return <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => goWorkspaceSection(item.id)}><Icon size={17}/><span>{item.label}</span>{item.id === "priorities" && userSignals.length > 0 && <i>{userSignals.length}</i>}</button>;})}</nav><div className="tb-sidebar-bottom"><div className="tb-local-state"><span className="green-led"/><div><b>In this browser session</b><small>No account · No chat upload</small></div></div><button className="tb-sidebar-clear" onClick={() => setClearConfirm(true)}><RotateCcw size={15}/> Clear all data</button><button className="tb-sidebar-back" onClick={() => resetToImport()}><ArrowLeft size={15}/> Import another chat</button></div></aside>
      {mobileNavOpen && <button className="tb-mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>}
      <main className="tb-workspace-main"><header className="tb-workspace-topbar"><button className="tb-icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19}/></button><div className="tb-breadcrumb"><span>THREADBACK</span><span>/</span><b>{NAV.find((n) => n.id === section)?.label ?? "Briefing"}</b></div><div className="tb-workspace-actions"><Pill tone={modelLoaded ? "green" : "amber"}>{modelLoaded ? "LOCAL AI READY" : "RULES ONLY"}</Pill><button className="tb-button tb-button-quiet tb-button-sm" onClick={exportBriefing}><Download size={14}/> Export TXT</button><button className="tb-button tb-button-quiet tb-button-sm" onClick={() => window.print()}><FileText size={14}/> Save PDF</button></div></header>
        <div className="tb-workspace-content">
          {analysisError && <div className="tb-notice"><AlertCircle size={17}/><span>{analysisError}</span><button onClick={() => setAnalysisError("")} aria-label="Dismiss"><X size={15}/></button></div>}
          {!modelLoaded && <div className="tb-ai-nudge"><div className="tb-ai-nudge-icon"><Sparkles size={18}/></div><div><b>{gpuStatus && !gpuStatus.supported ? "Local AI is unavailable on this device" : analysis ? "Analysis results available" : "Local AI has not been run for this chat"}</b><p>{gpuStatus && !gpuStatus.supported ? `${gpuStatus.reason} Deterministic priorities, date filtering, search and chat statistics remain available.` : analysis ? "You can revisit the briefing below. Run analysis again if you change the selected messages." : "Mentions, basic urgency, date filtering and chat stats are available now. Load the local model to generate summaries, decisions and grounded Q&A."}</p></div><button className="tb-button tb-button-primary tb-button-sm" disabled={!gpuStatus?.supported} onClick={() => { if (parsed) { void beginWorkspaceAI(); } }}><Zap size={14}/>{gpuStatus && !gpuStatus.supported ? "AI unavailable" : gpuStatus === null ? "Checking device…" : analysis ? "Re-analyze" : "Load local AI"}</button></div>}
          {section === "briefing" && <BriefingSection grounded={grounded} messages={messages} priorities={basicPriorityMessages} signals={signalById} onSource={setInspectorId} onNavigate={goWorkspaceSection} modelLoaded={modelLoaded} stats={stats}/>}
          {section === "priorities" && <PrioritiesSection messages={basicPriorityMessages} signals={signalById} userSignals={userSignals} onSource={setInspectorId} onReply={makeReplies} replyTarget={replyTarget} replyDrafts={replyDrafts} replyLoadingId={replyLoadingId} />}
          {section === "decisions" && <DecisionsSection items={allDecisions} messages={messages} onSource={setInspectorId} />}
          {section === "deadlines" && <DeadlinesSection modelDeadlines={allDeadlines} messages={messages} signals={signalById} onSource={setInspectorId} />}
          {section === "tasks" && <TasksSection tasks={allTasks} messages={messages} doneTasks={doneTasks} onToggle={toggleTask} onSource={setInspectorId} modelLoaded={modelLoaded} />}
          {section === "questions" && <QuestionsSection questions={openQuestions} messages={messages} onSource={setInspectorId} />}
          {section === "topics" && <TopicsSection topics={allTopics} messages={messages} onSource={setInspectorId} />}
          {section === "triage" && <TriageSection groups={triageGroups} signals={signalById} onSource={setInspectorId} onReply={makeReplies} replyTarget={replyTarget} replyDrafts={replyDrafts} replyLoadingId={replyLoadingId} />}
          {section === "ask" && <AskSection question={question} setQuestion={setQuestion} answer={answer} askLoading={askLoading} onSubmit={runAsk} onSource={setInspectorId} messages={messages} askMoment={askMoment} setAskMoment={setAskMoment} askMomentId={askMomentId} setAskMomentId={setAskMomentId} modelLoaded={modelLoaded} />}
          {section === "stats" && <StatsSection stats={stats} />}
          {section === "privacy" && <PrivacySection gpuStatus={gpuStatus} netSummary={netSummary} okay={privacyOkay} modelLoaded={modelLoaded} cached={modelCached} />}
          <div className="tb-print-brief"><h1>THREADBACK — Catch up on what matters</h1><p>Source: {fileName || "sample data"} · {messages.length} messages</p><h2>Executive summary</h2><p>{grounded?.summary || "Local AI summary has not been generated for this conversation."}</p><h2>Needs your attention</h2><ul>{triageGroups.reply.slice(0, 20).map((m) => <li key={m.id}><b>{m.sender}</b> — {m.text} ({formatDateTime(m.ts)})</li>)}</ul><h2>Action items</h2><ul>{allTasks.map((t, i) => <li key={`${t.task}-${i}`}>{t.task} · Owner: {t.owner ?? "not stated"} · Deadline: {t.deadline ?? "not stated"}</li>)}</ul><h2>Deadlines</h2><ul>{allDeadlines.map((d,i) => <li key={`${d.what}-${i}`}>{d.what} — {d.when}</li>)}</ul><h2>Decisions and changes</h2><ul>{allDecisions.map((d,i) => <li key={`${d.topic}-${i}`}>{d.topic}: {d.previous ? `${d.previous} → ` : ""}{d.latest}{d.uncertain ? " (uncertain)" : ""}</li>)}</ul><p>Generated locally by Threadback. Check original messages before relying on AI conclusions.</p></div><footer className="tb-workspace-footer"><span>THREADBACK / CATCH UP ON WHAT MATTERS</span><span><LockKeyhole size={12}/> Chat remains in session memory</span></footer>
        </div>
      </main>
      <AnimatePresence>{inspectorMessage && <MessageInspector key={inspectorMessage.id} message={inspectorMessage} context={inspectorContext} onClose={() => setInspectorId(null)} />}</AnimatePresence>
      {clearConfirm && <div className="tb-modal-backdrop"><div className="tb-modal"><div className="tb-modal-icon"><ShieldCheck size={22}/></div><h2>Clear this session?</h2><p>This removes the imported conversation and all generated results from the current app session. The browser's model cache may remain so future visits don't need another download.</p><div className="tb-modal-actions"><button className="tb-button tb-button-quiet" onClick={() => setClearConfirm(false)}>Keep working</button><button className="tb-button tb-button-danger" onClick={resetToImport}>Clear all data</button></div></div></div>}
    </div>}

    {showModelWarning && <div className="tb-modal-backdrop"><div className="tb-modal"><div className="tb-modal-icon"><Download size={22}/></div><div className="tb-eyebrow">FIRST-RUN MODEL DOWNLOAD</div><h2>Prepare your local AI</h2><p>Threadback needs to download the model files before the first AI analysis. The current estimate is around <b>{MODEL.approxDownloadMB} MB</b>, and the actual size may differ. The model runs on your device; your conversation is not uploaded.</p><div className="tb-model-specs"><span><b>{MODEL.id}</b><small>Model configured in this build</small></span><span><b>{MODEL.vramMB.toLocaleString()} MB</b><small>Configured VRAM estimate</small></span></div><p className="tb-modal-warning"><AlertTriangle size={15}/> Use a supported desktop browser and a stable connection. Loading can take several minutes and requires enough GPU memory.</p><div className="tb-modal-actions"><button className="tb-button tb-button-quiet" onClick={() => { setShowModelWarning(false); setStage("workspace"); setAnalysisError("Local AI was not started. Tier 0 features remain available."); }}>Not now</button><button className="tb-button tb-button-primary" onClick={() => { setShowModelWarning(false); void executeAnalysis(pendingSelectionRef.current.length ? pendingSelectionRef.current : selectedRangeMessages()); }}>Download & analyze <ArrowRight size={15}/></button></div></div></div>}
  </div>;
}

function BriefingSection({ grounded, messages, priorities, signals, onSource, onNavigate, modelLoaded, stats }: { grounded: Grounded | null; messages: Message[]; priorities: Message[]; signals: Map<string, Signals>; onSource: (id: string) => void; onNavigate: (s: Section) => void; modelLoaded: boolean; stats: ReturnType<typeof computeStats> }) {
  const top = priorities.slice(0, 4);
  const deadlinePreview = grounded?.deadlines.length
    ? grounded.deadlines.slice(0, 4).map((d) => ({ label: d.what, when: d.when, id: d.sources[0] }))
    : messages.flatMap((m) => (signals.get(m.id)?.deadlines ?? []).filter((d) => d.kind !== "time").map((d) => ({ label: d.text, when: d.date ? formatDate(Date.parse(`${d.date}T00:00:00Z`)) : d.note ?? "Date phrase; confirm context", id: m.id }))).slice(0, 4);
  return <>
    <SectionHeader eyebrow="THE CATCH-UP BRIEFING" title="Here's what you missed." copy="A prioritized view of the conversation — with source messages behind every important claim." right={<Pill tone="green"><ShieldCheck size={12}/> Source-linked</Pill>}/>
    <div className="tb-metric-grid"><Metric label="Messages reviewed" value={stats.total.toLocaleString()} sub="In selected range" icon={MessageCircle}/><Metric label="Participants" value={String(stats.participants)} sub="Active voices" icon={UserRound}/><Metric label="Needs attention" value={String(priorities.length)} sub="Rule-based signals" icon={Zap}/><Metric label="Plan changes" value={String(grounded?.decisions.filter((d) => !!d.previous).length ?? 0)} sub={grounded ? "Validated findings" : "Run AI analysis"} icon={GitCompare}/></div>
    <div className="tb-brief-grid"><section className="tb-panel tb-panel-feature"><PanelHeading icon={Zap} eyebrow="FIRST THINGS FIRST" title="Needs your attention" action={<button className="tb-inline-link" onClick={() => onNavigate("priorities")}>View all <ArrowRight size={13}/></button>}/>{top.length ? top.map((m) => {const s = signals.get(m.id); return <article className="tb-attention-row" key={m.id}><div className={`tb-severity ${s?.score && s.score >= 55 ? "high" : "medium"}`}/><div className="tb-attention-body"><b>{s?.mention ? `Mentioned: ${m.sender}` : m.sender ?? "System"}</b><p>{m.text}</p><div className="tb-reason-row">{(s?.reasons ?? []).slice(0, 2).map((reason) => <span key={reason}>{reason}</span>)}</div><SourceButton id={m.id} message={m} onClick={onSource}/></div></article>;}) : <EmptyState icon={CheckCircle2} title="No urgent signal detected" text="The rule-based pass didn't find a high-priority message in this selection."/>}</section>
      <section className="tb-panel"><PanelHeading icon={CalendarClock} eyebrow="COMING UP" title="Deadlines & dates" action={<button className="tb-inline-link" onClick={() => onNavigate("deadlines")}>View all <ArrowRight size={13}/></button>}/>{deadlinePreview.length ? deadlinePreview.map((d, i) => <div className="tb-compact-row" key={`${d.label}-${i}`}><span className="tb-date-square"><CalendarClock size={16}/></span><div><b>{d.label}</b><p>{d.when}</p><SourceButton id={d.id} message={messages.find((m) => m.id === d.id)} onClick={onSource}/></div></div>) : <EmptyState icon={Clock3} title="No deadlines detected" text="Basic date phrases appear here without AI. Load the local model for contextual deadline extraction."/>}</section>
    </div>
    <section className="tb-panel tb-summary-panel"><PanelHeading icon={BookOpen} eyebrow="THE BIG PICTURE" title="Conversation summary" action={!modelLoaded ? <Pill tone="amber">AI not run</Pill> : <Pill tone="green">AI analyzed</Pill>}/>{grounded?.summary ? <><p className="tb-summary-text">{grounded.summary}</p>{grounded.highlights.length > 0 && <div className="tb-highlights-grid">{grounded.highlights.slice(0, 4).map((h, i) => <div className="tb-highlight" key={`${h.text}-${i}`}><span>0{i + 1}</span><p>{h.text}</p><SourceButton id={h.sources[0]} message={messages.find((m) => m.id === h.sources[0])} onClick={onSource}/></div>)}</div>}</> : <EmptyState icon={Sparkles} title="Your summary is waiting" text="Threadback hasn't generated AI findings yet. Load the local model to summarize conversation context and connect every conclusion to source messages."/>}</section>
    <div className="tb-quick-grid">{[{ id: "decisions" as Section, title: "What changed?", copy: "Compare previous plans with the latest supported decision.", icon: GitCompare }, { id: "ask" as Section, title: "Ask your chat", copy: "Ask a question and inspect its supporting messages.", icon: Search }, { id: "triage" as Section, title: "Clear the backlog", copy: "Separate replies needed from deadlines and FYI.", icon: ListChecks }].map((x) => {const Icon = x.icon; return <button className="tb-quick-card" key={x.id} onClick={() => onNavigate(x.id)}><span><Icon size={18}/></span><b>{x.title}</b><p>{x.copy}</p><ArrowRight size={15}/></button>;})}</div>
  </>;
}
function Metric({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: typeof MessageCircle }) { return <div className="tb-metric"><div className="tb-metric-top"><span>{label}</span><Icon size={16}/></div><strong>{value}</strong><small>{sub}</small></div>; }
function PanelHeading({ icon: Icon, eyebrow, title, action }: { icon: typeof MessageCircle; eyebrow: string; title: string; action?: React.ReactNode }) { return <div className="tb-panel-heading"><div className="tb-panel-icon"><Icon size={17}/></div><div><span>{eyebrow}</span><h2>{title}</h2></div><div className="tb-panel-action">{action}</div></div>; }

function PrioritiesSection({ messages, signals, userSignals, onSource, onReply, replyTarget, replyDrafts, replyLoadingId }: { messages: Message[]; signals: Map<string, Signals>; userSignals: Signals[]; onSource: (id: string) => void; onReply: (m: Message) => void; replyTarget: string | null; replyDrafts: { text: string; sources: string[] }[]; replyLoadingId: string | null }) {
  return <><SectionHeader eyebrow="PERSONAL PRIORITIES" title="What needs you?" copy="Rule-based signals identify mentions, requests, possible deadlines and questions. Reasons are shown so the ranking is explainable."/><div className="tb-filter-pills"><Pill tone="red">{userSignals.filter((s) => s.score >= 55).length} high signal</Pill><Pill tone="amber">{userSignals.filter((s) => s.score >= 25 && s.score < 55).length} medium signal</Pill><Pill>{userSignals.length} total found</Pill></div>{messages.filter((m) => userSignals.some((s) => s.id === m.id)).sort((a,b) => (signals.get(b.id)?.score ?? 0) - (signals.get(a.id)?.score ?? 0)).map((m) => {const s = signals.get(m.id); return <article className="tb-list-card" key={m.id}><div className="tb-list-card-top"><div><Pill tone={s?.triage === "reply" ? "red" : s?.triage === "deadline" ? "amber" : "neutral"}>{s?.triage === "reply" ? "Reply needed" : s?.triage === "deadline" ? "Deadline soon" : "FYI"}</Pill><span className="tb-date-label">{formatDateTime(m.ts)}</span></div><span className="tb-score">{s?.score ?? 0}<small> signal</small></span></div><p className="tb-message-quote">{m.text}</p><div className="tb-reason-row">{s?.reasons.map((r) => <span key={r}>{r}</span>)}</div><div className="tb-list-card-footer"><SourceButton id={m.id} message={m} onClick={onSource}/><button className="tb-button tb-button-quiet tb-button-sm" onClick={() => onReply(m)}><MessageCircle size={14}/> Draft a reply</button></div>{replyLoadingId === m.id && <p className="tb-inline-loading">Drafting locally…</p>}{replyTarget === m.id && replyDrafts.length > 0 && <div className="tb-reply-drafts">{replyDrafts.map((r,i) => <div key={r.text+i}><p>{r.text}</p><button onClick={() => navigator.clipboard?.writeText(r.text)}><Clipboard size={13}/> Copy</button>{r.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((x) => x.id === id)} onClick={onSource}/>)}</div>)}</div>}</article>;})}{!userSignals.length && <EmptyState icon={CheckCircle2} title="No personal priority signals" text="No messages matching the selected user's mention, request or deadline patterns were found."/>}</>;
}
function DecisionsSection({ items, messages, onSource }: { items: Grounded["decisions"]; messages: Message[]; onSource: (id: string) => void }) {
  return <><SectionHeader eyebrow="DECISION HISTORY" title="What changed?" copy="Previous plans and latest supported plans are shown side by side. Later messages are not treated as final unless the evidence supports that."/>{items.length ? items.map((d,i) => <article className="tb-decision-card" key={`${d.topic}-${i}`}><div className="tb-decision-title"><div><span className="tb-eyebrow">DECISION {String(i+1).padStart(2,"0")}</span><h2>{d.topic}</h2></div>{d.uncertain ? <Pill tone="amber"><AlertTriangle size={12}/> Needs confirmation</Pill> : <Pill tone="green"><CheckCircle2 size={12}/> Supported</Pill>}</div><div className="tb-decision-compare"><div className="tb-before"><span>PREVIOUS PLAN</span><p>{d.previous ?? "No earlier plan cited"}</p></div><div className="tb-change-arrow"><ArrowRight size={18}/></div><div className="tb-after"><span>LATEST SUPPORTED</span><p>{d.latest}</p></div></div>{d.uncertaintyNote && <div className="tb-uncertainty"><AlertTriangle size={14}/>{d.uncertaintyNote}</div>}<div className="tb-source-list">{d.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((m) => m.id === id)} onClick={onSource}/>)}</div><p className="tb-tiny-muted">{d.flags.join(" · ")}</p></article>) : <EmptyState icon={GitCompare} title="No decision changes extracted" text="Run local AI analysis to identify revisions, previous plans and final decisions with evidence."/>}</>;
}
function DeadlinesSection({ modelDeadlines, messages, signals, onSource }: { modelDeadlines: Grounded["deadlines"]; messages: Message[]; signals: Map<string, Signals>; onSource: (id: string) => void }) {
  const basic = messages.flatMap((m) => (signals.get(m.id)?.deadlines ?? []).filter((d) => d.kind !== "time").map((d) => ({ what: d.text, when: d.date ? formatDate(Date.parse(`${d.date}T00:00:00Z`)) : d.note ?? "Date mentioned; exact date not resolved", id: m.id, source: m })));
  const seen = new Set<string>(); const combined = [...modelDeadlines.map((d) => ({ what: d.what, when: d.when, id: d.sources[0], source: messages.find((m) => m.id === d.sources[0]) })), ...basic].filter((d) => { const key = `${d.what.toLowerCase()}|${d.when.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
  return <><SectionHeader eyebrow="TIME-SENSITIVE SIGNALS" title="Deadlines & events" copy="Chronological phrases and AI-extracted commitments. Relative language can be ambiguous, especially across languages; check the source."/>{combined.length ? combined.map((d,i) => <article className="tb-deadline-card" key={`${d.id}-${d.what}-${i}`}><div className="tb-deadline-date"><CalendarClock size={18}/><span>{d.when}</span></div><div className="tb-deadline-body"><b>{d.what}</b><p>{d.source?.text ?? "Extracted from a cited conversation segment."}</p>{d.id && <SourceButton id={d.id} message={d.source} onClick={onSource}/>}</div></article>) : <EmptyState icon={CalendarClock} title="No deadlines found" text="Try a broader range or run local AI analysis for contextual deadline extraction."/>}</>;
}
function TasksSection({ tasks, messages, doneTasks, onToggle, onSource, modelLoaded }: { tasks: Grounded["actions"]; messages: Message[]; doneTasks: Set<string>; onToggle: (task: string) => void; onSource: (id: string) => void; modelLoaded: boolean }) {
  return <><SectionHeader eyebrow="ACTION ITEMS" title="Things to do" copy="Owners, deadlines and completion states are only shown when the supporting conversation provides evidence." right={<Pill>{doneTasks.size} marked done</Pill>}/>{tasks.length ? tasks.map((t,i) => <article className={`tb-task-card ${doneTasks.has(t.task) ? "completed" : ""}`} key={`${t.task}-${i}`}><button className="tb-task-check" aria-label={doneTasks.has(t.task) ? "Mark as open" : "Mark as done"} onClick={() => onToggle(t.task)}>{doneTasks.has(t.task) && <Check size={14}/>}</button><div className="tb-task-body"><div className="tb-task-tags"><Pill tone={t.priority === "high" ? "red" : t.priority === "medium" ? "amber" : "neutral"}>{t.priority} priority</Pill><Pill tone={t.kind === "explicit" ? "green" : "purple"}>{t.kind ?? "extracted"}</Pill></div><h3>{t.task}</h3><div className="tb-task-metadata"><span><UserRound size={13}/> {t.owner ?? "Owner not stated"}</span><span><CalendarClock size={13}/> {t.deadline ?? "Deadline not stated"}</span></div>{t.priorityReason && <p>{t.priorityReason}</p>}<div className="tb-source-list">{t.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((m) => m.id === id)} onClick={onSource}/>)}</div></div></article>) : <EmptyState icon={ListChecks} title={modelLoaded ? "No action items found" : "Action extraction needs local AI"} text={modelLoaded ? "No supported task-like items were extracted from this conversation." : "Rule-based priorities appear under Your priorities. Run the local model to extract structured tasks with owners and deadlines only when evidenced."}/>}</>;
}
function QuestionsSection({ questions, messages, onSource }: { questions: Grounded["questions"]; messages: Message[]; onSource: (id: string) => void }) {
  return <><SectionHeader eyebrow="UNRESOLVED THREADS" title="Open questions" copy="Questions the model could not locate an answer for across the analyzed range. Each item should be checked in context."/>{questions.length ? questions.map((q,i) => <article className="tb-list-card" key={`${q.question}-${i}`}><Pill tone="amber">Open question</Pill><h3 className="tb-q-title">{q.question}</h3><p className="tb-date-label">Asked by {q.askedBy ?? "Unknown participant"}</p><div className="tb-source-list">{q.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((m) => m.id === id)} onClick={onSource}/>)}</div></article>) : <EmptyState icon={HelpCircle} title="No open questions extracted" text="Run local AI analysis to identify questions that appear to remain unresolved."/>}</>;
}
function TopicsSection({ topics, messages, onSource }: { topics: Grounded["topics"]; messages: Message[]; onSource: (id: string) => void }) {
  return <><SectionHeader eyebrow="CONVERSATION THEMES" title="Topics & context" copy="Major threads condensed into a navigable overview, with links back to the messages that support each summary."/>{topics.length ? <div className="tb-topic-grid">{topics.map((t,i) => <article className="tb-topic-card" key={`${t.title}-${i}`}><span className="tb-topic-n">TOPIC {String(i+1).padStart(2,"0")}</span><h3>{t.title}</h3><p>{t.summary}</p><div className="tb-source-list">{t.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((m) => m.id === id)} onClick={onSource}/>)}</div></article>)}</div> : <EmptyState icon={BookOpen} title="Topics will appear here" text="Local AI groups related messages and summarizes each major discussion. No topic summaries are fabricated before analysis."/>}</>;
}
function TriageSection({ groups, signals, onSource, onReply, replyTarget, replyDrafts, replyLoadingId }: { groups: { reply: Message[]; deadline: Message[]; fyi: Message[] }; signals: Map<string, Signals>; onSource: (id: string) => void; onReply: (m: Message) => void; replyTarget: string | null; replyDrafts: { text: string; sources: string[] }[]; replyLoadingId: string | null }) {
  return <><SectionHeader eyebrow="SIGNAL, NOT NOISE" title="Message triage" copy="A transparent, rule-based pass puts likely replies and time-sensitive messages first. These are heuristics, not guaranteed interpretations."/><div className="tb-triage-columns">{([{ id: "reply", title: "Reply needed", messages: groups.reply, tone: "red" }, { id: "deadline", title: "Deadline soon", messages: groups.deadline, tone: "amber" }, { id: "fyi", title: "FYI", messages: groups.fyi, tone: "neutral" }] as const).map((group) => <section className="tb-triage-column" key={group.id}><div className="tb-triage-title"><Pill tone={group.tone}>{group.title}</Pill><span>{group.messages.length}</span></div>{group.messages.slice(0, 20).map((m) => <article className="tb-triage-message" key={m.id}><div className="tb-triage-meta"><b>{m.sender ?? "System"}</b><span>{formatDateTime(m.ts)}</span></div><p>{m.text}</p><div className="tb-triage-footer"><button onClick={() => onSource(m.id)}>Inspect source</button>{group.id !== "fyi" && <button onClick={() => onReply(m)}><MessageCircle size={12}/> Draft reply</button>}</div>{replyLoadingId === m.id && <small>Drafting locally…</small>}{replyTarget === m.id && replyDrafts.map((r,i) => <div className="tb-inline-reply" key={r.text+i}>{r.text}<button onClick={() => navigator.clipboard?.writeText(r.text)}><Clipboard size={12}/> Copy</button></div>)}</article>)}{!group.messages.length && <div className="tb-triage-empty">Nothing in this category.</div>}</section>)}</div></>;
}
function AskSection({ question, setQuestion, answer, askLoading, onSubmit, onSource, messages, askMoment, setAskMoment, askMomentId, setAskMomentId, modelLoaded }: { question: string; setQuestion: (s: string) => void; answer: Answer | null; askLoading: boolean; onSubmit: (e: React.FormEvent) => void; onSource: (id: string) => void; messages: Message[]; askMoment: boolean; setAskMoment: (b: boolean) => void; askMomentId: string; setAskMomentId: (s: string) => void; modelLoaded: boolean }) {
  const suggestions = ["What did we decide?", "Which tasks need me?", "When is the next deadline?", "What changed in the plan?"];
  return <><SectionHeader eyebrow="GROUNDED QUESTION ANSWERING" title="Ask your chat." copy="Answers are generated only after local retrieval finds supporting messages. If the conversation doesn't support an answer, Threadback says so."/><div className="tb-ask-layout"><section className="tb-ask-main"><div className="tb-ask-heading"><span className="tb-ai-avatar"><Sparkles size={19}/></span><div><b>Threadback assistant</b><span><i/> {modelLoaded ? "Local model ready" : "Local model not loaded"}</span></div></div><div className="tb-ask-intro"><h2>What do you want to remember?</h2><p>Ask about a decision, a task, a person or a specific moment in the selected messages.</p></div><form className="tb-ask-form" onSubmit={onSubmit}><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Did the event time change?" rows={3}/><div className="tb-ask-form-bottom"><label className="tb-checkbox-line"><input type="checkbox" checked={askMoment} onChange={(e) => setAskMoment(e.target.checked)}/> Ask this moment</label><button className="tb-button tb-button-primary" type="submit" disabled={askLoading || !question.trim()}>{askLoading ? "Searching…" : "Ask from chat"} <Send size={14}/></button></div>{askMoment && <label className="tb-field tb-moment-select"><span>Select a message to anchor context</span><select value={askMomentId} onChange={(e) => setAskMomentId(e.target.value)}>{messages.slice(-150).map((m) => <option key={m.id} value={m.id}>{formatDateTime(m.ts)} · {m.sender}: {m.text.slice(0, 70)}</option>)}</select></label>}</form>
      {!answer && <div className="tb-suggested-questions"><span className="tb-eyebrow">TRY ASKING</span>{suggestions.map((s) => <button key={s} onClick={() => setQuestion(s)}>{s} <ArrowUpRight size={13}/></button>)}</div>}
      {answer && <article className={`tb-answer-card ${answer.status !== "answered" ? "answer-limited" : ""}`}><div className="tb-answer-status"><span className="tb-ai-avatar small"><Sparkles size={14}/></span><b>{answer.status === "answered" ? "Answer from your chat" : answer.status === "clarify" ? "More context needed" : "Not enough evidence"}</b>{answer.status === "answered" ? <Pill tone="green">Cited answer</Pill> : <Pill tone="amber">Grounding check</Pill>}</div><p>{answer.text}</p>{answer.conflicting.length > 0 && <div className="tb-uncertainty"><AlertTriangle size={14}/> Potentially conflicting time references: {answer.conflicting.join(", ")}</div>}{answer.sources.length > 0 && <div className="tb-answer-sources"><span className="tb-eyebrow">SOURCE MESSAGES</span>{answer.sources.map((id) => <SourceButton key={id} id={id} message={messages.find((m) => m.id === id)} onClick={onSource}/>)}</div>}</article>}
    </section><aside className="tb-ask-sidebar"><div className="tb-ask-guard"><ShieldCheck size={20}/><b>Evidence before answers</b><p>Threadback searches the selected messages first. It refuses unrelated questions and rejects answers without valid source references.</p></div><div className="tb-ask-guard"><LockKeyhole size={20}/><b>On-device inference</b><p>The local model runs in the browser worker. No cloud AI call is used as a fallback.</p></div><div className="tb-ask-guard"><Search size={20}/><b>Moment-aware context</b><p>Choose a message to narrow the retrieval range, while retaining nearby context.</p></div></aside></div></>;
}
function StatsSection({ stats }: { stats: ReturnType<typeof computeStats> }) {
  const max = Math.max(1, ...stats.perParticipant.map((x) => x.count));
  return <><SectionHeader eyebrow="CONVERSATION ACTIVITY" title="The shape of the chat." copy="Exact counts and timestamps are calculated deterministically from the locally parsed export."/><div className="tb-metric-grid"><Metric label="Messages" value={stats.total.toLocaleString()} sub="Selected range" icon={MessageCircle}/><Metric label="Participants" value={String(stats.participants)} sub="Distinct senders" icon={UserRound}/><Metric label="Busiest day" value={stats.busiestDay?.day ?? "—"} sub={stats.busiestDay ? `${stats.busiestDay.count} messages` : "No data"} icon={CalendarClock}/><Metric label="Top contributor" value={stats.perParticipant[0]?.name ?? "—"} sub={stats.perParticipant[0] ? `${stats.perParticipant[0].count} messages` : "No data"} icon={Activity}/></div><section className="tb-panel tb-participant-panel"><PanelHeading icon={UserRound} eyebrow="MESSAGE DISTRIBUTION" title="Messages by participant"/>{stats.perParticipant.map((p) => <div className="tb-participant-row" key={p.name}><div className="tb-avatar-small">{getInitials(p.name)}</div><span>{p.name}</span><div className="tb-participant-bar"><i style={{ width: `${p.count / max * 100}%` }}/></div><b>{p.count}</b></div>)}</section></>;
}
function PrivacySection({ gpuStatus, netSummary, okay, modelLoaded, cached }: { gpuStatus: GpuStatus | null; netSummary: NetSummary; okay: boolean; modelLoaded: boolean; cached: boolean }) {
  return <><SectionHeader eyebrow="LOCAL-FIRST BY DESIGN" title="Privacy you can inspect." copy="Threadback has no database, account or server API that receives chat data. The app's fetch monitor records request metadata only, not message contents."/><div className="tb-privacy-status"><div className="privacy-big-icon"><ShieldCheck size={28}/></div><div><span className="tb-eyebrow">FETCH MONITOR STATUS</span><h2>{okay ? "No chat-bearing fetch request observed" : "Review network activity"}</h2><p>{okay ? "Since this session started, the monitored fetch calls have not shown a request body or an unrecognized external fetch host. This is evidence from the app's fetch monitor, not a guarantee about every browser network mechanism." : "The monitored fetch layer observed request bodies or a host outside the configured model-host allowlist. Inspect the details before making privacy claims."}</p></div><Pill tone={okay ? "green" : "amber"}>{okay ? "NO BODY OBSERVED" : "CHECK NETWORK"}</Pill></div><div className="tb-metric-grid"><Metric label="Model host requests" value={String(netSummary.modelHostRequests)} sub="Model files / runtime assets" icon={Download}/><Metric label="Other fetch hosts" value={String(netSummary.otherHostRequests)} sub="Outside model allowlist" icon={AlertCircle}/><Metric label="Observed body bytes" value={String(netSummary.bodyBytesSent)} sub={`${netSummary.unknownBodies} unknown body size(s)`} icon={Activity}/><Metric label="Model cache" value={cached ? "Cached" : modelLoaded ? "Loaded" : "Not loaded"} sub={cached ? "Browser model cache found" : "May download on first run"} icon={LockKeyhole}/></div><div className="tb-privacy-grid"><div className="tb-privacy-card"><CheckCircle2 size={19}/><b>Stays in session memory</b><p>Imported messages, local summaries and answers stay in this tab's application state unless you export them manually.</p></div><div className="tb-privacy-card"><Download size={19}/><b>Model files may download</b><p>The selected model and compiled runtime are downloaded from configured static hosts. Browser caches may persist model files after Clear All Data.</p></div><div className="tb-privacy-card"><Activity size={19}/><b>Network hosts observed</b>{netSummary.otherHosts.length ? <ul>{netSummary.otherHosts.map((h) => <li key={h}>{h}</li>)}</ul> : <p>No non-model external fetch hosts recorded by the current monitor.</p>}</div><div className="tb-privacy-card"><ShieldCheck size={19}/><b>WebGPU capability</b><p>{gpuStatus === null ? "Checking browser GPU capability…" : gpuStatus.supported ? `Available (${gpuStatus.adapterInfo}). Model memory requirements still apply.` : gpuStatus.reason}</p></div></div><div className="tb-privacy-note"><AlertTriangle size={16}/><p><b>Important:</b> the app monitor wraps fetch calls in the page and WebLLM worker. It does not inspect every browser-level network mechanism. For a demo, verify the browser DevTools Network panel and CSP. Never describe this indicator as a complete network audit.</p></div></>;
}
function MessageInspector({ message, context, onClose }: { message: Message; context: Message[]; onClose: () => void }) {
  return <motion.div className="tb-inspector-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}><motion.aside className="tb-inspector" initial={{ x: 440 }} animate={{ x: 0 }} exit={{ x: 440 }} transition={{ type: "spring", damping: 30, stiffness: 260 }} onClick={(e) => e.stopPropagation()}><header><div><span className="tb-eyebrow">SOURCE INSPECTOR</span><h2>Verify the message</h2></div><button className="tb-icon-button" onClick={onClose}><PanelRightClose size={18}/></button></header><div className="tb-inspector-selected"><span className="tb-inspector-selected-tag"><CheckCircle2 size={13}/> SELECTED SOURCE</span><div className="tb-message-meta"><b>{message.sender ?? "System message"}</b><span>{formatDateTime(message.ts)}</span></div><p>{message.text || "[No message text]"}</p><small>Message ID · {message.id}</small></div><div className="tb-inspector-context-title"><span className="tb-eyebrow">NEARBY CONTEXT</span><span>{context.length} messages</span></div><div className="tb-inspector-messages">{context.map((m) => <article key={m.id} className={`tb-inspector-message ${m.id === message.id ? "selected" : ""}`}><div className="tb-message-meta"><b>{m.sender ?? "System"}</b><span>{formatDateTime(m.ts)}</span></div><p>{m.text || "[No message text]"}</p>{m.id === message.id && <span className="tb-current-source">CURRENT SOURCE</span>}</article>)}</div><div className="tb-inspector-note"><ShieldCheck size={15}/> Threadback keeps original message text unchanged.</div></motion.aside></motion.div>;
}
