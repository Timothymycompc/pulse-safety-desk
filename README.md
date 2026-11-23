# Pulse Safety Desk

**Check it before you sign.** An open agentic website where a small team of AI agents checks Solana tokens, transactions and wallets for the known ways people get robbed, using live [Solana Pulse](https://solana-pulse-gateway-1021990235790.us-central1.run.app) data.

Built for the Cognizant [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/), following the [open agentic web spec](https://github.com/cognizant-ai-labs/agentic-web) (MVP Profile 0.2).

## The agents

| Agent | Job | Solana Pulse tools (MCP) |
|---|---|---|
| `safety_desk` (front) | Routes the question, writes the verdict | none (delegates) |
| `token_checker` | Mint/freeze authority, copycats, liquidity, insiders | `find_token`, `token_safety`, `whats_this` |
| `tx_checker` | What a transaction does, drainer patterns | `explain_tx`, `check_tx`, `why_failed` |
| `wallet_tracer` | Holdings, drains, where funds went | `wallet`, `history`, `trace` |

All agents run **in the visitor's browser** on the reference runtime ([nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy), Apache-2.0, vendored in `web/runtime/`).

## For other agent sites

Load the desk as a peer network and check before you act:

```
https://<this-site>/pulse_safety_desk
```

Published files: `/agent-manifest.json` and `/pulse_safety_desk.network.json`, both with CORS. The peer runs on the caller's own model router; the caller's key never reaches this site.

### Live example: Wallet Helper

[Wallet Helper](https://pulse-wallet-helper-1021990235790.us-central1.run.app) is a second agent site on its own origin, built from this repo (`helper/`). It reads a Solana wallet itself (Solana Pulse `wallet`, `balance`, `history`) and hands every safety question to the desk:

```
Wallet Helper (its own origin)  ->  Pulse Safety Desk (this site, loaded as a peer)  ->  Solana Pulse MCP
```

The visitor approves the hand-off before the browser contacts the desk. The desk's agents then run in the visitor's browser on Wallet Helper's model, and the desk's server sees nothing. Wallet Helper's manifest allows only the desk and Solana Pulse (`allowed_peers`), while the desk itself is open to any site.

Tested live 2026-11-16 (`scripts/e2e.mjs`): "Someone sent me a token I don't know" + the BONK mint went Wallet Helper -> desk -> token checker -> Pulse `token_safety` and came back SAFE with the "known traps only" caveat, in 33 s; a wallet question read holdings, balance and history, and the numbers matched Pulse's `/api/tools/wallet` and `/api/tools/balance`.

## How it's built

- `web/`: the agentic website (page, network definition, runtime).
- `helper/`: Wallet Helper's page and network. The same server runs it when `DESK_SITE=helper`, borrowing only the runtime, `site.js` and `theme.css` from `web/`.
- `server/`: a small Express server that serves `web/`, builds the manifest for the serving origin, and offers two model routes:
  - `/llm/v1`: free default inference (server-held Gemini key, one cheap model, capped per visitor and per day; visitor IPs are never stored).
  - `/byok/v1`: forwards only the visitor's own key (bring your own key).
- The vendored runtime carries three small fixes, listed in [`web/runtime/CHANGES.md`](web/runtime/CHANGES.md): site-funded default model, MCP tool limits, and Gemini's parallel tool calls.
- A line for the shared free model (`server/queue.ts`): calls are spaced to the free tier's per-minute limit, and the page shows each visitor's place in line and wait time.
- The model proxy adds Gemini's documented placeholder thought signature to earlier tool calls, which the runtime does not keep.
- Grounding guard (`server/grounding.ts`): every answer from the free model is checked before the page sees it. A Solana address that appears nowhere in the question or the tool results makes the model rewrite once from the tool results; any address still made up is removed. It covers addresses only: the model can still word a fact loosely (seen once in three live runs of the attack demo, 2026-11-23), so the answer always names the Pulse tool each fact came from.
- Secrets come from Google Secret Manager at startup. Deployed on Google Cloud Run.

```
npm install
npm test
npm run dev        # http://localhost:8080
npm run ship       # test, commit, push, deploy both sites
bash scripts/deploy.sh helper            # deploy only Wallet Helper
node scripts/e2e.mjs [site] "question"   # runs the real runtime against a live desk
```

## Principles

See [PRINCIPLES.md](PRINCIPLES.md). In short: a check can't make anything safe; SAFE means none of the known traps were found. Every fact comes from real data and names its source, and missing data is "unknown", never a guess.

## Links

- Solana Pulse: https://solana-pulse-gateway-1021990235790.us-central1.run.app
- X: https://x.com/solanapulsebots
- YouTube: https://www.youtube.com/@timothymycompc1205
- Pulse on GitHub: https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway

License: MIT for this project's code; the vendored runtime in `web/runtime/` is Apache-2.0 (see `web/runtime/LICENSE.txt`).
