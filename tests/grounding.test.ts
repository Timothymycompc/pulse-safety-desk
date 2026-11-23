// The free route never lets an answer name an address that no tool returned (server/grounding.ts).
// Case from 2026-11-23: on the demo attack transaction the model named a made-up program
// "ComUaJ5HC..." for two steps Solana Pulse had decoded as Compute Budget.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { llmRoutes, resetLimits } from "../server/llm.ts";
import { asEventStream, inventedAddresses, REMOVED } from "../server/grounding.ts";

const REAL = "Brpc8HoPo1d3Uiyo7kbERnjMqwLJJmbWxtwxHxzar6DU";
const MADE_UP = "ComUaJ5HCWXDXfUfRt8L9LmkNNHaWN4eSTmTzC471yH";
const conversation = [
  { role: "user", content: `I meant to send 0.01 SOL to ${REAL}. Transaction: AgAAAA+abc/xyz=` },
  { role: "tool", tool_call_id: "t1", content: JSON.stringify({ verdict: "MISMATCH", unexpected: ["the sender loses 5.0100104 SOL"], steps: [{ program: "Compute Budget", program_id: "ComputeBudget111111111111111111111111111111" }] }) },
];

async function listen(app: express.Express) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
const answer = (content: string | null, extra: any = {}) =>
  new Response(JSON.stringify({ id: "x", model: "m", choices: [{ index: 0, message: { role: "assistant", content, ...extra }, finish_reason: "stop" }] }), { headers: { "content-type": "application/json" } });
const streamed = async (r: Response) => {
  const text = await r.text();
  const first = text.split("\n").find((l) => l.startsWith("data: {"))!;
  return JSON.parse(first.slice(6)).choices[0];
};

test("an address is invented only if it appears nowhere in the question or the tool results", () => {
  assert.deepEqual(inventedAddresses(`Sends to ${REAL}; step 0 is ComputeBudget111111111111111111111111111111.`, conversation), []);
  assert.deepEqual(inventedAddresses(`Step 0 (${MADE_UP}: unknown_program)`, conversation), [MADE_UP]);
  assert.deepEqual(inventedAddresses("REVIEW: the blockhash has expired. 4TCM…p66B sent 42.6 SOL.", conversation), [], "plain words and shortened addresses are fine");
});

test("an answer with an invented address is rewritten once from the tool results, and the page still gets its stream", async () => {
  const sent: any[] = [];
  const replies = [answer(`BLOCK. Step 0 (${MADE_UP}) is unknown.`), answer(`MISMATCH from tx_matches: the sender loses 5.0100104 SOL. Recipient ${REAL}.`)];
  const fake = (async (_url: any, init: any) => { sent.push(JSON.parse(init.body)); return replies.shift()!; }) as typeof fetch;
  const app = express();
  app.use(llmRoutes(() => "KEY", fake));
  const { base, close } = await listen(app);
  resetLimits();
  try {
    const r = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: conversation, stream: true }) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /text\/event-stream/);
    const choice = await streamed(r);
    assert.equal(choice.delta.content, `MISMATCH from tx_matches: the sender loses 5.0100104 SOL. Recipient ${REAL}.`);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].stream, false, "the answer is fetched whole so it can be checked");
    assert.match(sent[1].messages.at(-1).content, new RegExp(`${MADE_UP}.*appear nowhere`));
  } finally { close(); }
});

test("if the rewrite still invents an address, it is removed and the answer says so", async () => {
  const replies = [answer(`Step 0 is ${MADE_UP}.`), answer(`Step 0 is still ${MADE_UP}.`)];
  const fake = (async () => replies.shift()!) as typeof fetch;
  const app = express();
  app.use(llmRoutes(() => "KEY", fake));
  const { base, close } = await listen(app);
  resetLimits();
  try {
    const r = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: conversation }) });
    const body: any = await r.json();
    assert.equal(body.choices[0].message.content, `Step 0 is still ${REMOVED}.`);
  } finally { close(); }
});

test("tool calls pass through untouched, with their index and thought signature", async () => {
  const call = { id: "c1", type: "function", function: { name: "tx_checker", arguments: `{"transaction":"${MADE_UP}"}` }, extra_content: { google: { thought_signature: "SIG" } } };
  let calls = 0;
  const fake = (async () => { calls += 1; return answer(null, { tool_calls: [call] }); }) as typeof fetch;
  const app = express();
  app.use(llmRoutes(() => "KEY", fake));
  const { base, close } = await listen(app);
  resetLimits();
  try {
    const r = await fetch(`${base}/llm/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: conversation, stream: true }) });
    const choice = await streamed(r);
    assert.equal(calls, 1, "tool calls are not checked or re-asked");
    assert.deepEqual(choice.delta.tool_calls, [{ index: 0, ...call }]);
  } finally { close(); }
});

test("the stream ends with [DONE] like the provider's", () => {
  assert.match(asEventStream({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }), /data: \[DONE\]\n\n$/);
});
