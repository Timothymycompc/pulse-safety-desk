# Changes to the vendored runtime

This folder is the browser runtime from [cognizant-ai-lab/nsdeploy](https://github.com/cognizant-ai-lab/nsdeploy)
(`nsdeploy/runtime/`, Apache-2.0, see `LICENSE.txt`; upstream commit in `UPSTREAM_COMMIT`).
Pulse Safety Desk changed five things. Each change is marked `[pulse-safety-desk patch]` in the code.

1. `engine.js`, `llm.js`: a manifest may set `llm_router.publisher_funded: true`, so the site's own
   default router runs without a visitor key (spec section 4, "Default inference"). Peers inherit it
   only as the caller's router; a peer manifest can't turn it on.
2. `runner.js`: an MCP descriptor `{ url, tools: [...] }` now limits the tools an agent sees
   (spec section 2.1). Before, every tool on the server was offered.
3. `llm.js`: parallel tool calls that share a stream index but have different ids (as Gemini sends
   them) are kept apart instead of merged; the provider's `extra_content` (Gemini thought
   signatures) is kept on each call.
4. `ui.js`: the page's own key checks (the "API key required" badge, the opened settings and the
   block on Send) now honor the publisher-funded router from change 1. Before, the engine could run
   without a visitor key but the page still stopped every visitor and asked for one. The badge reads
   "Free model · no key needed" instead.
5. `ui.js`: the Developer view's agent graph printed `[object Object]` for an MCP descriptor
   `{ url, tools }` (change 2); it now shows the server's host.
