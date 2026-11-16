// site.js — small page touches after the runtime boots. Agent logic lives in the runtime.
const COLORS = { AVOID: "#f43f5e", CAUTION: "#f59e0b", SAFE: "#10b981", UNKNOWN: "#8a94a8" };
const WORD = /\b(AVOID|CAUTION|SAFE|UNKNOWN)\b/;

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
