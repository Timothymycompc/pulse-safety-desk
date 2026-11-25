// llm.ts — the two model routes the browser runtime can use.
//
// /llm/v1  = the site's default inference (publisher-funded). On the live site it goes to
//            PAID Vertex AI on the site's own Google Cloud project (2026-11-25): Google's
//            free Gemini tier may use prompts for training and human review, must not get
//            personal information, and may not serve users in the EEA, UK or Switzerland.
//            The free key is only a fallback for local development with no Vertex project.
//            One cheap model, capped request size and daily volume.
// /byok/v1 = Bring Your Own Key. Forwards exactly the visitor's Authorization header
//            to Gemini and never adds the server key (spec section 4, "caller-site BYOK proxy").
//
// Visitor IP addresses are never stored or logged. The per-visitor limit keys on a
// salted hash that lives only in memory and resets every hour.

import type { Request, Response, Router } from "express";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { ModelQueue } from "./queue.js";
import { asEventStream, correctionMessages, inventedAddresses, removeAddresses } from "./grounding.js";

/** A final answer (no tool calls) may only name addresses the conversation contains: rewrite once, then remove. */
export async function grounded(completion: any, messages: unknown[], ask: (m: unknown[]) => Promise<globalThis.Response>): Promise<any> {
  const msg = completion?.choices?.[0]?.message;
  if (!msg || typeof msg.content !== "string" || (Array.isArray(msg.tool_calls) && msg.tool_calls.length)) return completion;
  const invented = inventedAddresses(msg.content, messages);
  if (!invented.length) return completion;
  try {
    const again = await ask([...messages, ...correctionMessages(msg.content, invented)]);
    if (again.ok) {
      const second: any = await again.json();
      const m2 = second?.choices?.[0]?.message;
      if (m2 && typeof m2.content === "string" && !(Array.isArray(m2.tool_calls) && m2.tool_calls.length)) {
        const still = inventedAddresses(m2.content, messages);
        m2.content = removeAddresses(m2.content, still);
        return second;
      }
    } else await again.body?.cancel().catch(() => {});
  } catch { /* fall through: keep the first answer, minus the invented addresses */ }
  msg.content = removeAddresses(msg.content, invented);
  return completion;
}

export const GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";

// Paid model: Vertex AI on the site's own Google Cloud project, billed to it, using the service's
// own identity (no key). Set DESK_VERTEX_PROJECT (the live site does) to use it for every request.
export type Paid = { url: string; model: string; token: () => Promise<string> };
export function vertexModel(project = process.env.DESK_VERTEX_PROJECT, model = process.env.DESK_VERTEX_MODEL || "google/gemini-3.5-flash-lite"): Paid | null {
  if (!project) return null;
  let cached = { token: "", until: 0 };
  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi/chat/completions`,
    model,
    token: async () => {
      if (cached.token && Date.now() < cached.until) return cached.token;
      const r = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } });
      const j = await r.json() as { access_token: string; expires_in: number };
      cached = { token: j.access_token, until: Date.now() + Math.max(60, j.expires_in - 120) * 1000 };
      return cached.token;
    },
  };
}
export const DEFAULT_MODEL = process.env.DESK_MODEL || "gemini-flash-lite-latest";

const DAILY_CAP = Number(process.env.DESK_DAILY_CAP || 1200); // whole site, default route only
const HOURLY_PER_VISITOR = Number(process.env.DESK_HOURLY_PER_VISITOR || 60);
const MAX_OUTPUT_TOKENS = 2048;
const MAX_BODY = "400kb";
export let RETRY_WAITS_MS = [2000, 5000, 10000];
/** Test hook: shortens retry waits. */
export function setRetryWaits(ms: number[]): void { RETRY_WAITS_MS = ms; }

let day = "";
let dayCount = 0;
let hour = "";
let salt = randomBytes(16);
const perVisitor = new Map<string, number>();

/** Counts one default-route request. Returns a reason string when it must be refused. */
export function admit(visitorKey: string, now = new Date()): string | null {
  const d = now.toISOString().slice(0, 10);
  const h = now.toISOString().slice(0, 13);
  if (d !== day) { day = d; dayCount = 0; }
  if (h !== hour) { hour = h; perVisitor.clear(); salt = randomBytes(16); }
  if (dayCount >= DAILY_CAP) return "The free model on this site has reached today's limit. Add your own key in AI model settings (the gear icon) to keep going.";
  const id = createHash("sha256").update(salt).update(visitorKey).digest("hex").slice(0, 16);
  const n = perVisitor.get(id) || 0;
  if (n >= HOURLY_PER_VISITOR) return "You've reached this hour's free limit. Wait a bit, or add your own key in AI model settings (the gear icon).";
  perVisitor.set(id, n + 1);
  dayCount += 1;
  return null;
}

/** Test hook: clears all counters. */
export function resetLimits(): void { day = ""; dayCount = 0; hour = ""; perVisitor.clear(); }

function refuse(res: Response, status: number, message: string): void {
  res.status(status).json({ error: { message, type: "desk_limit", code: status } });
}

/** Copies an upstream response (streamed or not) to the client. */
async function relay(upstream: globalThis.Response, res: Response): Promise<void> {
  res.status(upstream.status);
  const type = upstream.headers.get("content-type");
  if (type) res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  if (!upstream.body) { res.end(); return; }
  Readable.fromWeb(upstream.body as any).pipe(res);
}

// Gemini 3 models require each earlier function call to carry its "thought signature".
// The reference browser runtime does not keep it, so earlier tool calls get Google's
// documented placeholder signature (ai.google.dev, "Thought signatures": dummy values
// for history that has none). The visitor's messages are otherwise passed unchanged.
export const PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator";

export function withThoughtSignatures(messages: any[]): any[] {
  return messages.map((m) => {
    if (!m || m.role !== "assistant" || !Array.isArray(m.tool_calls)) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((c: any) =>
        c?.extra_content?.google?.thought_signature
          ? c
          : { ...c, extra_content: { ...(c?.extra_content || {}), google: { ...(c?.extra_content?.google || {}), thought_signature: PLACEHOLDER_SIGNATURE } } }),
    };
  });
}

/** Keeps only fields an OpenAI-compatible chat call needs, so the proxy can't be used for anything else. */
export function cleanBody(body: any, forceModel?: string): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || !Array.isArray(body.messages)) return null;
  const out: Record<string, unknown> = {
    model: forceModel || (typeof body.model === "string" ? body.model : DEFAULT_MODEL),
    messages: withThoughtSignatures(body.messages),
    stream: body.stream === true,
  };
  if (Array.isArray(body.tools) && body.tools.length) { out.tools = body.tools; out.tool_choice = body.tool_choice ?? "auto"; }
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (forceModel) out.max_tokens = MAX_OUTPUT_TOKENS;
  else if (typeof body.max_tokens === "number") out.max_tokens = body.max_tokens;
  return out;
}

export function llmRoutes(getKey: () => string | undefined, fetchImpl: typeof fetch = fetch, queue = new ModelQueue(), paid: Paid | null = vertexModel()): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  r.post("/llm/v1/chat/completions", async (req: Request, res: Response) => {
    const key = paid ? undefined : getKey(); // paid model set: the free-tier key is never used
    if (!key && !paid) return refuse(res, 503, "The site's free model is not configured right now. Add your own key in AI model settings.");
    const body = cleanBody(req.body, DEFAULT_MODEL);
    if (!body) return refuse(res, 400, "Expected an OpenAI-style chat request with messages.");
    const why = admit(req.ip || req.socket.remoteAddress || "unknown");
    if (why) return refuse(res, 429, why);
    // Wait in line for the shared free model (see queue.ts). The page shows the position.
    const ticket = String(req.get("x-desk-ticket") || "").slice(0, 64);
    try { await queue.acquire(ticket); } catch (e) { return refuse(res, 429, (e as Error).message); }
    if (req.socket.destroyed) return; // visitor left while waiting
    try {
      // Asked for whole (not streamed) so the answer can be checked before the page sees it
      // (grounding.ts); the page still gets the stream format it asked for.
      const wantsStream = body.stream === true;
      const send = async (messages: unknown[]) => paid
        ? fetchImpl(paid.url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${await paid.token()}` },
            body: JSON.stringify({ ...body, model: paid.model, messages, stream: false }),
          })
        : fetchImpl(`${GEMINI_OPENAI}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ ...body, messages, stream: false }),
          });
      // The free tier allows only a few requests per minute. On a per-minute limit,
      // wait and retry before giving up, so a busy moment doesn't break an answer.
      const sendWithRetry = async (messages: unknown[]) => {
        let upstream = await send(messages);
        for (const wait of RETRY_WAITS_MS) {
          if (upstream.status !== 429) break;
          await upstream.body?.cancel().catch(() => {});
          await new Promise((r) => setTimeout(r, wait));
          upstream = await send(messages);
        }
        return upstream;
      };
      const messages = body.messages as unknown[];
      const upstream = await sendWithRetry(messages);
      if (upstream.status === 429) {
        await upstream.body?.cancel().catch(() => {});
        return refuse(res, 429, "The free model is busy right now. Try again in a minute, or add your own key in AI model settings (the gear icon).");
      }
      if (!upstream.ok) return relay(upstream, res);
      let completion: any = await upstream.json();
      completion = await grounded(completion, messages, sendWithRetry);
      res.setHeader("cache-control", "no-store");
      if (wantsStream) { res.setHeader("content-type", "text/event-stream"); return void res.send(asEventStream(completion)); }
      res.json(completion);
    } catch {
      refuse(res, 502, "Could not reach the model provider. Please try again.");
    }
  });

  // Where this tab is in line: { waiting, position, eta_seconds, per_minute }.
  r.get("/queue", (req: Request, res: Response) => {
    res.setHeader("cache-control", "no-store");
    res.json(queue.status(String(req.query.ticket || "").slice(0, 64)));
  });

  r.get("/llm/v1/models", (_req, res) => { res.json({ object: "list", data: [{ id: DEFAULT_MODEL, object: "model" }] }); });

  r.post("/byok/v1/chat/completions", async (req: Request, res: Response) => {
    const auth = req.get("authorization") || "";
    if (!/^Bearer \S{10,}$/.test(auth)) return refuse(res, 401, "Add your Gemini API key in AI model settings to use your own key.");
    const body = cleanBody(req.body);
    if (!body) return refuse(res, 400, "Expected an OpenAI-style chat request with messages.");
    try {
      const upstream = await fetchImpl(`${GEMINI_OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(body),
      });
      await relay(upstream, res);
    } catch {
      refuse(res, 502, "Could not reach the model provider. Please try again.");
    }
  });

  return r;
}
