// e2e.mjs — runs the real browser runtime in Node against a live desk and asks one question.
// Usage: node scripts/e2e.mjs [siteUrl] "question"
import { pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const site = process.argv[2] || "https://pulse-safety-desk-1021990235790.us-central1.run.app";
const q = process.argv[3] || "Is this token safe? DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location ??= new URL(site + "/");
const rt = path.join(here, "../web/runtime");
const { Engine } = await import(pathToFileURL(path.join(rt, "engine.js")).href);
const { TraceBus } = await import(pathToFileURL(path.join(rt, "trace.js")).href);
const trace = new TraceBus();
const engine = new Engine({ originUrl: site, trace });
const consents = [];
engine.onConsent = async (info) => { consents.push(info.peerOrigin + " (" + (info.phase || "call") + ")"); return "always"; };
const { validation } = await engine.loadTop();
console.log("loaded; errors:", validation.errors.length, "| router:", engine.top.llm.baseUrl, "| mock:", engine.mockLLM);
const t0 = Date.now();
const out = await engine.run(q);
console.log("seconds:", ((Date.now() - t0) / 1000).toFixed(1));
console.log("consents asked:", consents);
console.log("ANSWER:\n" + (typeof out === "string" ? out : JSON.stringify(out, null, 1)).slice(0, 2500));
// Tool and model calls, with errors, for debugging (secrets are never in spans).
if (process.env.E2E_TRACE) {
  for (const s of trace.spans.values()) {
    if (!/tool|mcp|model_call|agent/.test(s.kind)) continue;
    const err = s.error?.message || s.error || s.errorMessage || "";
    console.log("SPAN", s.kind, s.status, s.tool || s.method || s.agent || "", String(err).slice(0, 400), "| ms", Math.round(s.durationMs || 0));
  }
}
// Machine-checkable summary for tests: which tools each model call was offered.
if (process.env.E2E_JSON) {
  const offered = [...trace.spans.values()].filter((s) => s.kind === "model_call").map((s) => s.toolNames || []);
  const called = [...trace.spans.values()].filter((s) => s.kind === "tool").map((s) => s.tool);
  console.log("E2E_JSON " + JSON.stringify({ offered, called, answer: typeof out === "string" ? out : "" }));
}
