// Server tests: manifest shape, CORS on public agent files, and the two model routes.
// Gemini is replaced by a fake fetch, so no network or key is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import express from "express";
import { createApp } from "../server/index.ts";
import { llmRoutes, cleanBody, admit, resetLimits, setRetryWaits, DEFAULT_MODEL } from "../server/llm.ts";
import { buildManifest, manifestFor, siteFromEnv, NETWORK, HELPER_NETWORK, DESK_ORIGIN } from "../server/manifest.ts";

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

test("manifest points every route at the serving origin and names the front agent", () => {
  const m: any = buildManifest("https://desk.example/");
  assert.equal(m.networks[0].name, NETWORK);
  assert.equal(m.networks[0].front_man, "safety_desk");
  assert.equal(m.llm_router.base_url, "https://desk.example/llm/v1");
  assert.equal(m.llm_router.byok_router, "https://desk.example/byok/v1");
  assert.equal(m.llm_router.mock, false);
  assert.equal(m.llm_router.publisher_funded, true);
  assert.equal(m.peer_policy.mode, "open");
});

test("network file's front agent matches the manifest and every helper uses Solana Pulse MCP", () => {
  const net = JSON.parse(readFileSync(new URL("../web/pulse_safety_desk.network.json", import.meta.url), "utf8"));
  assert.equal(net.tools[0].name, (buildManifest("https://x") as any).networks[0].front_man);
  for (const agent of net.tools.slice(1)) {
    const mcp = agent.tools.find((t: any) => typeof t === "object");
    assert.match(mcp.url, /solana-pulse-gateway.*\/mcp$/, agent.name);
    assert.ok(mcp.tools.length > 0, agent.name);
  }
});

test("public agent files are served with CORS for other agent sites; sandbox worker gets its CSP", async () => {
  const { base, close } = await listen(createApp(() => undefined));
  try {
    const man = await fetch(`${base}/agent-manifest.json`);
    assert.equal(man.headers.get("access-control-allow-origin"), "*");
    assert.equal((await man.json() as any).llm_router.base_url, `${base}/llm/v1`);
    const net = await fetch(`${base}/${NETWORK}.network.json`);
    assert.equal(net.status, 200);
    assert.equal(net.headers.get("access-control-allow-origin"), "*");
    const worker = await fetch(`${base}/runtime/sandbox-worker.js`);
    assert.match(worker.headers.get("content-security-policy") || "", /connect-src 'none'/);
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Pulse Safety Desk/);
  } finally { close(); }
});

test("cleanBody keeps only chat fields and forces the default model on the free route", () => {
  const out: any = cleanBody({ model: "gemini-4-argon", messages: [{ role: "user", content: "hi" }], stream: true, n: 9, user: "x" }, DEFAULT_MODEL);
  assert.equal(out.model, DEFAULT_MODEL);
  assert.equal(out.n, undefined);
  assert.equal(out.user, undefined);
  assert.equal(out.max_tokens, 2048);
  assert.equal(cleanBody({ prompt: "no messages" }), null);
});

test("free route adds the server key; BYOK route forwards only the visitor's key", async () => {
  const seen: { url: string; auth: string; body: any }[] = [];
  const fake = (async (url: any, init: any) => {
    seen.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], model: "m" }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const app = express();
  app.use(llmRoutes(() => "SERVER-KEY-123", fake));
  const { base, close } = await listen(app);
  resetLimits();
  try {
    const body = JSON.stringify({ model: "anything", messages: [{ role: "user", content: "hi" }] });
    const free = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(free.status, 200);
    assert.equal(seen[0].auth, "Bearer SERVER-KEY-123");
    assert.equal(seen[0].body.model, DEFAULT_MODEL);

    const noKey = await fetch(`${base}/byok/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(noKey.status, 401);
    assert.equal(seen.length, 1, "BYOK without a key must not reach the provider");

    const byok = await fetch(`${base}/byok/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer VISITOR-KEY-456" }, body });
    assert.equal(byok.status, 200);
    assert.equal(seen[1].auth, "Bearer VISITOR-KEY-456");
    assert.ok(!JSON.stringify(seen[1]).includes("SERVER-KEY"), "server key must never be used for BYOK");
  } finally { close(); }
});

test("free route refuses cleanly with no server key", async () => {
  const app = express();
  app.use(llmRoutes(() => undefined, (async () => { throw new Error("must not call"); }) as any));
  const { base, close } = await listen(app);
  try {
    const r = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [] }) });
    assert.equal(r.status, 503);
  } finally { close(); }
});

test("earlier tool calls get a thought signature; existing signatures are kept", () => {
  const out: any = cleanBody({ messages: [
    { role: "user", content: "check token" },
    { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "token_checker", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "a", content: "AVOID" },
    { role: "assistant", content: null, tool_calls: [{ id: "b", type: "function", function: { name: "x", arguments: "{}" }, extra_content: { google: { thought_signature: "REAL" } } }] },
  ] });
  assert.equal(out.messages[1].tool_calls[0].extra_content.google.thought_signature, "skip_thought_signature_validator");
  assert.equal(out.messages[3].tool_calls[0].extra_content.google.thought_signature, "REAL");
  assert.equal(out.messages[0].content, "check token");
});

test("free route retries a per-minute limit, then answers; gives a clear message if it never clears", async () => {
  setRetryWaits([1, 1, 1]);
  let calls = 0;
  const flaky = (async () => {
    calls += 1;
    return calls < 3
      ? new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 })
      : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const app = express();
  app.use(llmRoutes(() => "K-123456789", flaky));
  const { base, close } = await listen(app);
  resetLimits();
  try {
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
    const ok = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(ok.status, 200);
    assert.equal(calls, 3);
    calls = -100; // stays limited for every retry
    const busy = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(busy.status, 429);
    assert.match(((await busy.json()) as any).error.message, /busy/);
  } finally { close(); setRetryWaits([2000, 5000, 10000]); }
});

test("per-visitor hourly limit and reset", () => {
  resetLimits();
  const now = new Date("2026-11-16T10:00:00Z");
  let refused: string | null = null;
  for (let i = 0; i < 61 && !refused; i++) refused = admit("visitor-a", now);
  assert.match(refused || "", /free limit/);
  assert.equal(admit("visitor-b", now), null, "another visitor is unaffected");
  assert.equal(admit("visitor-a", new Date("2026-11-16T11:00:00Z")), null, "resets next hour");
});

test("Wallet Helper manifest: own router, desk as an allowed peer, no open policy", () => {
  const m: any = manifestFor("helper", "https://helper.example");
  assert.equal(m.brand, "Wallet Helper");
  assert.equal(m.networks[0].name, HELPER_NETWORK);
  assert.equal(m.networks[0].front_man, "wallet_helper");
  assert.equal(m.llm_router.base_url, "https://helper.example/llm/v1");
  assert.equal(m.llm_router.publisher_funded, true);
  assert.ok(m.allowed_peers.includes(DESK_ORIGIN));
  assert.equal(m.peer_policy, undefined);
  assert.equal(siteFromEnv("helper"), "helper");
  assert.equal(siteFromEnv(undefined), "desk");
});

test("Wallet Helper network hands safety questions to the desk on another origin", () => {
  const net = JSON.parse(readFileSync(new URL("../helper/wallet_helper.network.json", import.meta.url), "utf8"));
  assert.equal(net.tools[0].name, "wallet_helper");
  assert.ok(net.tools[0].tools.includes(`${DESK_ORIGIN}/${NETWORK}`));
  const reader = net.tools.find((t: any) => t.name === "wallet_reader");
  const mcp = reader.tools.find((t: any) => typeof t === "object");
  assert.deepEqual(mcp.tools, ["wallet", "balance", "history"]);
});

test("helper site serves its own page and network plus the shared runtime, never the desk's files", async () => {
  const { base, close } = await listen(createApp(() => undefined, "helper"));
  try {
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /<title>Wallet Helper<\/title>/);
    const m: any = await (await fetch(`${base}/agent-manifest.json`)).json();
    assert.equal(m.brand, "Wallet Helper");
    const net = await fetch(`${base}/wallet_helper.network.json`);
    assert.equal(net.status, 200);
    assert.equal(net.headers.get("access-control-allow-origin"), "*");
    assert.equal((await fetch(`${base}/runtime/index.js`)).status, 200);
    assert.equal((await fetch(`${base}/theme.css`)).status, 200);
    assert.equal((await fetch(`${base}/pulse_safety_desk.network.json`)).status, 404);
  } finally { close(); }
});
