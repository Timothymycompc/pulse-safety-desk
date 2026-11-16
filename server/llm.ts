// llm.ts — the two model routes the browser runtime can use.
//
// /llm/v1  = the site's default inference (publisher-funded). The server adds its own
//            Gemini key, forces one cheap model and caps request size and daily volume,
//            so a visitor can use the desk without any key of their own.
// /byok/v1 = Bring Your Own Key. Forwards exactly the visitor's Authorization header
//            to Gemini and never adds the server key (spec section 4, "caller-site BYOK proxy").
//
// Visitor IP addresses are never stored or logged. The per-visitor limit keys on a
// salted hash that lives only in memory and resets every hour.

import type { Request, Response, Router } from "express";
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

export const GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_MODEL = process.env.DESK_MODEL || "gemini-flash-lite-latest";

const DAILY_CAP = Number(process.env.DESK_DAILY_CAP || 1200); // whole site, default route only
const HOURLY_PER_VISITOR = Number(process.env.DESK_HOURLY_PER_VISITOR || 60);
const MAX_OUTPUT_TOKENS = 2048;
const MAX_BODY = "400kb";

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

export function llmRoutes(getKey: () => string | undefined, fetchImpl: typeof fetch = fetch): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  r.post("/llm/v1/chat/completions", async (req: Request, res: Response) => {
    const key = getKey();
    if (!key) return refuse(res, 503, "The site's free model is not configured right now. Add your own key in AI model settings.");
    const body = cleanBody(req.body, DEFAULT_MODEL);
    if (!body) return refuse(res, 400, "Expected an OpenAI-style chat request with messages.");
    const why = admit(req.ip || req.socket.remoteAddress || "unknown");
    if (why) return refuse(res, 429, why);
    try {
      const upstream = await fetchImpl(`${GEMINI_OPENAI}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      await relay(upstream, res);
    } catch {
      refuse(res, 502, "Could not reach the model provider. Please try again.");
    }
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
