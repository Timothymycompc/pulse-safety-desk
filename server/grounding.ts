// grounding.ts: the desk's "never invent an address" rule, enforced in code.
//
// The free model sometimes writes a Solana address that no tool returned (2026-11-23: on the
// demo attack transaction it named a made-up program "ComUaJ5HC..." for steps that Solana
// Pulse decoded as Compute Budget). A final answer is checked before the page sees it: every
// address-shaped string in it must appear somewhere in the conversation (the question, or a
// tool result). If one doesn't, the model is asked once to rewrite from the tool results; if
// it still does, the address is removed and the answer says so.

/** Solana addresses and signatures: base58, 32-88 characters. */
const ADDRESS = /[1-9A-HJ-NP-Za-km-z]{32,88}/g;

export const REMOVED = "[address removed: not in Solana Pulse's results]";

/** Address-shaped strings in an answer that appear nowhere in the conversation it answers. */
export function inventedAddresses(answer: string, messages: unknown[]): string[] {
  const seen = JSON.stringify(messages);
  const found = answer.match(ADDRESS) || [];
  return [...new Set(found.filter((a) => !seen.includes(a)))];
}

/** The follow-up that asks the model to rewrite an answer without the invented addresses. */
export function correctionMessages(answer: string, invented: string[]): any[] {
  return [
    { role: "assistant", content: answer },
    {
      role: "user",
      content: `Your answer names ${invented.join(", ")}, which appear nowhere in the question or the tool results. ` +
        "Rewrite the answer using only addresses, names and numbers that the tool results contain. Copy them exactly. Same format as before.",
    },
  ];
}

/** Last resort: takes out addresses that are still invented after the rewrite. */
export function removeAddresses(answer: string, invented: string[]): string {
  let out = answer;
  for (const a of invented) out = out.split(a).join(REMOVED);
  return out;
}

/** One finished completion as the server-sent-event stream the browser runtime reads. */
export function asEventStream(completion: any): string {
  const choice = completion?.choices?.[0] || {};
  const msg = choice.message || {};
  const delta: Record<string, unknown> = { role: "assistant" };
  if (msg.content) delta.content = msg.content;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    delta.tool_calls = msg.tool_calls.map((c: any, index: number) => ({ index, ...c }));
  }
  const chunk = {
    id: completion?.id,
    object: "chat.completion.chunk",
    model: completion?.model,
    choices: [{ index: 0, delta, finish_reason: choice.finish_reason ?? "stop" }],
    ...(completion?.usage ? { usage: completion.usage } : {}),
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}
