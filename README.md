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

## How it's built

- `web/`: the agentic website (page, network definition, runtime).
- `server/`: a small Express server that serves `web/`, builds the manifest for the serving origin, and offers two model routes:
  - `/llm/v1`: free default inference (server-held Gemini key, one cheap model, capped per visitor and per day; visitor IPs are never stored).
  - `/byok/v1`: forwards only the visitor's own key (bring your own key).
- Secrets come from Google Secret Manager at startup. Deployed on Google Cloud Run.

```
npm install
npm test
npm run dev        # http://localhost:8080
npm run ship       # test, commit, push, deploy
```

## Principles

See [PRINCIPLES.md](PRINCIPLES.md). In short: a check can't make anything safe; SAFE means none of the known traps were found. Every fact comes from real data and names its source, and missing data is "unknown", never a guess.

## Links

- Solana Pulse: https://solana-pulse-gateway-1021990235790.us-central1.run.app
- X: https://x.com/solanapulsebots
- YouTube: https://www.youtube.com/@timothymycompc1205
- Pulse on GitHub: https://github.com/Timothymycompc/solana-pulse-ai-agent-gateway

License: MIT for this project's code; the vendored runtime in `web/runtime/` is Apache-2.0 (see `web/runtime/LICENSE.txt`).
- The vendored runtime carries one patch (marked `[pulse-safety-desk patch]` in `engine.js` and `llm.js`): a manifest can set `llm_router.publisher_funded: true` so the site's own default router runs without a visitor key (spec section 4, Default inference). Offer it upstream to nsDeploy.
