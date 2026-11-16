// manifest.ts — builds agent-manifest.json (spec 3.3) for whatever origin the site is served on,
// so the same build works locally, on Cloud Run's URL and on a custom domain.

export const NETWORK = "pulse_safety_desk";
export const HELPER_NETWORK = "wallet_helper";
export const PULSE_ORIGIN = "https://solana-pulse-gateway-1021990235790.us-central1.run.app";
export const DESK_ORIGIN = "https://pulse-safety-desk-1021990235790.us-central1.run.app";

// Which site this server is: "desk" (Pulse Safety Desk, default) or "helper" (Wallet Helper,
// a second agent site on its own origin that loads the desk as a peer).
export type Site = "desk" | "helper";
export function siteFromEnv(v = process.env.DESK_SITE): Site {
  return v === "helper" ? "helper" : "desk";
}

// Same model routes on every site; each site pays for its own default model.
function router(o: string) {
  return {
    base_url: `${o}/llm/v1`,
    mock: false,
    byok_router: `${o}/byok/v1`,
    publisher_funded: true,
    default_model: "gemini-flash-lite-latest",
    provider: "Google Gemini (OpenAI-compatible)",
  };
}

const DEPLOYMENT = {
  mode: "static",
  self_contained_runtime: true,
  browser_mock: false,
  direct_byok: false,
  direct_mcp_requires_cors: true,
  public_mcp_facade: false,
};

export function manifestFor(site: Site, origin: string): Record<string, unknown> {
  return site === "helper" ? buildHelperManifest(origin) : buildManifest(origin);
}

// Wallet Helper: reads wallets itself, hands every safety question to the desk on another origin.
// It allows only the two origins it needs (the desk and Solana Pulse), unlike the desk's open policy.
export function buildHelperManifest(origin: string): Record<string, unknown> {
  const o = origin.replace(/\/$/, "");
  return {
    brand: "Wallet Helper",
    networks: [
      {
        name: HELPER_NETWORK,
        front_man: "wallet_helper",
        hocon: `./${HELPER_NETWORK}.network.json`,
        description: "Reads a Solana wallet in plain words. Safety questions go to Pulse Safety Desk, a separate agent site loaded as a peer.",
        tags: ["solana", "wallet", "peer-demo", "solana-pulse"],
        sample_queries: [
          "What's in this wallet, and are any of its tokens risky? <wallet address>",
          "What happened in this wallet lately? <wallet address>",
        ],
      },
    ],
    llm_router: router(o),
    allowed_peers: [DESK_ORIGIN, PULSE_ORIGIN],
    linking: {
      imports: [{ name: NETWORK, url: `${DESK_ORIGIN}/${NETWORK}`, description: "Safety checks for tokens, transactions and wallets." }],
      exports: [{ name: HELPER_NETWORK, url: `${o}/${HELPER_NETWORK}`, description: "Plain-words Solana wallet reader." }],
    },
    data_sources: [{ name: "Solana Pulse", mcp: `${PULSE_ORIGIN}/mcp`, site: PULSE_ORIGIN }],
    theme: { primary: "#c9a227" },
    deployment: DEPLOYMENT,
  };
}

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
          "Check this transaction before I sign it: <paste the base64 transaction>. I meant to send 5 USDC to <address>.",
          "My wallet got drained. Where did my funds go?",
        ],
      },
    ],
    // Default inference is publisher-funded (server adds its key, capped per day).
    // BYOK goes through /byok/v1, which forwards only the visitor's own key.
    llm_router: router(o),
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
    deployment: DEPLOYMENT,
  };
}
