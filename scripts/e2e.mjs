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
