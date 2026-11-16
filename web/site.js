// site.js — small page touches after the runtime boots. Agent logic lives in the runtime.
const COLORS = { AVOID: "#f43f5e", BLOCK: "#f43f5e", CAUTION: "#f59e0b", REVIEW: "#f59e0b", SAFE: "#10b981", OK: "#10b981", UNKNOWN: "#8a94a8" };
const WORD = /\b(AVOID|BLOCK|CAUTION|REVIEW|SAFE|OK|UNKNOWN)\b/;

// Colors verdict words in one answer. Already-colored words are skipped, so it is safe to rerun.
function paint(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.parentElement?.dataset.deskVerdict) continue;
    if (WORD.test(n.nodeValue)) hits.push(n);
  }
  for (const node of hits) {
    const frag = document.createDocumentFragment();
    for (const part of node.nodeValue.split(WORD)) {
      if (COLORS[part]) {
        const s = document.createElement("strong");
        s.textContent = part;
        s.dataset.deskVerdict = part;
        s.style.color = COLORS[part];
        frag.append(s);
      } else if (part) frag.append(part);
    }
    node.replaceWith(frag);
  }
}

export async function customize({ root }) {
  let queued = false;
  const run = () => {
    queued = false;
    for (const m of root.querySelectorAll(".ns-msg.bot:not(.ns-consent):not(.ns-turn-status)")) paint(m);
  };
  new MutationObserver(() => {
    if (!queued) { queued = true; setTimeout(run, 250); }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}

// ---- Line for the shared free model --------------------------------------------
// Each tab gets a random ticket. Model calls to this site carry it, and while one is
// waiting the page shows "You're #N in line · about X s". Nothing personal is sent.
const TICKET = (crypto.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 36);
let pending = 0;
let polling = null;

function lineBanner() {
  let el = document.getElementById("desk-line");
  if (!el) {
    el = document.createElement("div");
    el.id = "desk-line";
    el.className = "desk-line";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.hidden = true;
    document.querySelector(".desk-app-wrap")?.prepend(el);
  }
  return el;
}

async function pollLine() {
  const el = lineBanner();
  try {
    const r = await fetch(`./queue?ticket=${encodeURIComponent(TICKET)}`, { cache: "no-store" });
    const s = await r.json();
    if (s.position > 0) {
      el.innerHTML = `<span class="desk-line-dot"></span>You're <b>#${s.position}</b> in line for the free model · about <b>${s.eta_seconds} s</b>. Your question will run automatically.`;
      el.hidden = false;
    } else el.hidden = true;
  } catch { el.hidden = true; }
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (!/\/llm\/v1\/chat\/completions$/.test(new URL(url, location.href).pathname)) return realFetch(input, init);
  const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
  headers.set("x-desk-ticket", TICKET);
  pending += 1;
  if (!polling) { polling = setInterval(pollLine, 1500); setTimeout(pollLine, 400); }
  try {
    return await realFetch(input, { ...init, headers });
  } finally {
    pending -= 1;
    if (pending <= 0 && polling) { clearInterval(polling); polling = null; lineBanner().hidden = true; }
  }
};
