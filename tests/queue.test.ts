// Queue tests with a fake clock: first come first served, spacing per minute, position and wait time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelQueue } from "../server/queue.ts";

test("starts calls right away while under the per-minute limit", async () => {
  const q = new ModelQueue(3);
  await q.acquire("a"); await q.acquire("b"); await q.acquire("c");
  const s = q.status("a");
  assert.equal(s.waiting, 0);
  assert.equal(s.position, 0);
  assert.ok(s.eta_seconds > 55 && s.eta_seconds <= 60, "a newcomer now would wait for the oldest slot to free");
});

test("over the limit, callers wait in order and see their position and wait time", async () => {
  let t = 1_000_000;
  const q = new ModelQueue(2, 240_000, 200, 60_000, () => t);
  await q.acquire("x"); // started at t
  t += 10_000;
  await q.acquire("y"); // started at t+10s
  const order: string[] = [];
  const first = q.acquire("me").then(() => order.push("me"));
  const second = q.acquire("you").then(() => order.push("you"));
  assert.equal(q.status("me").position, 1);
  assert.equal(q.status("you").position, 2);
  assert.equal(q.status("me").eta_seconds, 50, "first slot frees 60 s after x started");
  assert.equal(q.status("you").eta_seconds, 60, "second slot frees 60 s after y started");
  assert.equal(q.status("nobody").position, 0);
  t += 50_001;
  (q as any).pump();
  await first;
  assert.deepEqual(order, ["me"]);
  t += 10_000;
  (q as any).pump();
  await second;
  assert.deepEqual(order, ["me", "you"]);
  assert.equal(q.status().waiting, 0);
});

test("refuses with a clear message when the wait would be too long", async () => {
  const t = 5_000_000;
  const q = new ModelQueue(1, 30_000, 200, 60_000, () => t);
  await q.acquire("a");
  await assert.rejects(q.acquire("b"), /line for the free model is too long/);
});
