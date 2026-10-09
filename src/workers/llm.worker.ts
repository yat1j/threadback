/// <reference lib="webworker" />
import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";
import { patchFetch } from "@/lib/network-monitor";

// Report (host, method, body SIZE) of every fetch made INSIDE the worker (this is where model files download).
const bc = new BroadcastChannel("threadback-net");
patchFetch(self as unknown as { fetch: typeof fetch }, (e) => bc.postMessage(e));

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
