// manifest.ts — builds agent-manifest.json (spec 3.3) for whatever origin the site is served on,
// so the same build works locally, on Cloud Run's URL and on a custom domain.

export const NETWORK = "pulse_safety_desk";
export const PULSE_ORIGIN = "https://solana-pulse-gateway-1021990235790.us-central1.run.app";

export function buildManifest(origin: string): Record<string, unknown> {
  const o = origin.replace(/\/$/, "");
  return {
    brand: "Pulse Safety Desk",
    networks: [
      {
        name: NETWORK,
        front_man: "safety_desk",
        hocon: `./${NETWORK}.network.json`,
        description: "Checks Solana tokens, transactions and wallets for the known ways people get robbed, before you or your agent act. Every fact comes from live Solana Pulse data.",
        tags: ["solana", "safety", "scam-check", "mcp", "solana-pulse"],
        sample_queries: [
          "Is this token safe to buy? DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
          "What does this transaction do? Paste a signature.",
          "My wallet got drained. Where did my funds go?",
        ],
      },
    ],
    // Default inference is publisher-funded (server adds its key, capped per day).
    // BYOK goes through /byok/v1, which forwards only the visitor's own key.
    llm_router: {
      base_url: `${o}/llm/v1`,
      mock: false,
      byok_router: `${o}/byok/v1`,
      default_model: "gemini-flash-lite-latest",
      provider: "Google Gemini (OpenAI-compatible)",
    },
    allowed_peers: [PULSE_ORIGIN],
    peer_policy: {
      mode: "open",
      deny_origins: [],
      note: "Any agent site may load this network and run it in its own visitor's browser. Credentials and capabilities do not transfer.",
    },
    linking: {
      exports: [{ name: NETWORK, url: `${o}/${NETWORK}`, description: "Solana safety checks for agents: tokens, transactions, wallets." }],
    },
    data_sources: [{ name: "Solana Pulse", mcp: `${PULSE_ORIGIN}/mcp`, site: PULSE_ORIGIN }],
    theme: { primary: "#c9a227" },
    deployment: {
      mode: "static",
      self_contained_runtime: true,
      browser_mock: false,
      direct_byok: false,
      direct_mcp_requires_cors: true,
      public_mcp_facade: false,
    },
  };
}
