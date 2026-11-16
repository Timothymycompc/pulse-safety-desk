// index.ts — Pulse Safety Desk server.
// Serves the open agentic website (static files + the browser agent runtime) and the
// two model routes in llm.ts. All agent logic runs in the visitor's browser.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecrets } from "./secrets.js";
import { llmRoutes } from "./llm.js";
import { manifestFor, siteFromEnv, NETWORK, HELPER_NETWORK, type Site } from "./manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = process.env.DESK_WEB_DIR || path.resolve(here, "../web");
const HELPER = path.resolve(WEB, "../helper");
// Files the Wallet Helper borrows from the desk's folder: the runtime, the page script and the theme.
// Nothing else (no desk page or network file) is served from the helper's origin.
const SHARED = /^\/(runtime\/.+|site\.js|theme\.css)$/;

// Sandbox worker CSP from the reference runtime: peer code runs with no network access.
const WORKER_CSP = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";
// Page CSP: scripts only from this origin; the browser may call this origin, Solana Pulse (MCP)
// and any https peer agent site or BYOK router the visitor approves.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-src https:; base-uri 'none'; form-action 'self'";

export function publicOrigin(req: express.Request): string {
  if (process.env.DESK_PUBLIC_URL) return process.env.DESK_PUBLIC_URL.replace(/\/$/, "");
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

export function createApp(
  getKey: () => string | undefined = () => process.env.GEMINI_API_KEY,
  site: Site = siteFromEnv(),
): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    // Public agent artifacts must be readable by agent sites on other origins (spec 3.3, 3.4).
    if (req.path.endsWith(".json")) {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    }
    if (req.path.endsWith("/sandbox-worker.js")) res.setHeader("content-security-policy", WORKER_CSP);
    else if (req.path === "/" || req.path.endsWith(".html")) res.setHeader("content-security-policy", PAGE_CSP);
    next();
  });

  app.get("/health", (_req, res) => { res.json({ ok: true, model_key: !!getKey() }); });

  app.get("/agent-manifest.json", (req, res) => {
    res.setHeader("cache-control", "public, max-age=300");
    res.json(manifestFor(site, publicOrigin(req)));
  });

  // The peer address (https://<site>/<network>) is what other agent sites load. A person who opens it
  // in a browser goes to the page section that explains it; anything else gets a pointer to the manifest.
  const network = site === "helper" ? HELPER_NETWORK : NETWORK;
  app.get(`/${network}`, (req, res) => {
    if (req.accepts(["html", "json"]) === "html") return res.redirect(302, site === "helper" ? "/#how" : "/#for-agents");
    res.setHeader("access-control-allow-origin", "*");
    res.json({ network, manifest: "/agent-manifest.json", hocon: `/${network}.network.json`, note: "Agent sites load this network through the manifest." });
  });

  app.use(llmRoutes(getKey));

  const statics = {
    extensions: ["html"],
    setHeaders: (res: express.Response, file: string) => {
      if (file.endsWith(".js") || file.endsWith(".mjs")) res.setHeader("content-type", "text/javascript; charset=utf-8");
      res.setHeader("cache-control", file.includes(`${path.sep}runtime${path.sep}`) ? "public, max-age=3600" : "public, max-age=300");
    },
  };
  if (site === "helper") {
    app.use(express.static(HELPER, statics));
    const shared = express.static(WEB, { ...statics, extensions: false as const });
    app.use((req, res, next) => (SHARED.test(req.path) ? shared(req, res, next) : next()));
  } else {
    app.use(express.static(WEB, statics));
  }

  app.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain || process.env.DESK_START === "1") {
  await loadSecrets(["GEMINI_API_KEY"]);
  const port = Number(process.env.PORT || 8080);
  const site = siteFromEnv();
  createApp(undefined, site).listen(port, () => console.log(`${site === "helper" ? "Wallet Helper" : "Pulse Safety Desk"} on :${port}`));
}
