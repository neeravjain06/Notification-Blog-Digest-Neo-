// Shared by notifications.html / news.html / blogs.html. No framework, no build step.
// Everything rendered here comes from an LLM or a third-party RSS feed, so text is always
// escaped before it reaches innerHTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Only http(s) links are allowed - a javascript: URL from a feed must not become an href.
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? esc(u) : "");

// Inline [text](https://...) links only. Runs on already-escaped text, so a quote or angle bracket
// in the URL cannot break out of the attribute; non-http(s) schemes never match.
const inline = (t) =>
  esc(t).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

// Tiny markdown subset: "## heading", "- bullet" lines, blank-line separated paragraphs.
function renderMarkdown(md) {
  const html = [];
  let list = false;
  const closeList = () => { if (list) { html.push("</ul>"); list = false; } };
  for (const raw of String(md).split("\n")) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith("## ")) { closeList(); html.push(`<h3>${inline(line.slice(3))}</h3>`); }
    else if (/^[-*] /.test(line)) { if (!list) { html.push("<ul>"); list = true; } html.push(`<li>${inline(line.slice(2))}</li>`); }
    else { closeList(); html.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return html.join("");
}

function card(p) {
  const stub = p.engine === "stub";
  const link = safeUrl(p.sourceUrl);
  return `<article class="card">
    <h2>${esc(p.title)}</h2>
    <div class="meta">${esc(p.publishedAt.slice(0, 10))} · ${esc(p.sourceRef.length > 40 ? p.source : p.sourceRef)}
      · <span class="badge ${stub ? "stub" : ""}">${stub ? "STUB - placeholder text" : esc(p.engine)}</span>
      · ${p.industries.map(esc).join(", ")}</div>
    <p>${esc(p.excerpt)}</p>
    ${p.impact ? `<p class="impact">${esc(p.impact)}</p>` : ""}
    <details><summary>Read full post</summary>${renderMarkdown(p.body)}</details>
    ${link ? `<p><a href="${link}" target="_blank" rel="noopener noreferrer">Official source</a></p>` : ""}
    <p class="disclaimer">${esc(p.disclaimer)}</p>
  </article>`;
}

async function loadPage(pipeline) {
  const postsEl = document.getElementById("posts");
  const filtersEl = document.getElementById("filters");
  let active = "";

  async function load() {
    const q = active ? `?industry=${encodeURIComponent(active)}` : "";
    const res = await fetch(`/api/posts/${pipeline}${q}`);
    if (!res.ok) { postsEl.innerHTML = `<p class="muted">Failed to load (HTTP ${res.status}).</p>`; return; }
    const data = await res.json();
    postsEl.innerHTML = data.posts.length
      ? data.posts.map(card).join("")
      : `<p class="muted">No posts yet. Use "Run now" on the <a href="/">admin panel</a>.</p>`;
    return data.posts;
  }

  // Build the filter chips once, from the unfiltered list.
  const all = await load();
  if (!all) return;
  const industries = [...new Set(all.flatMap((p) => p.industries))].sort();
  if (industries.length > 1) {
    const chips = ["", ...industries];
    filtersEl.innerHTML = chips.map((i) => `<button class="chip ${i === "" ? "on" : ""}" data-i="${esc(i)}">${esc(i || "all")}</button>`).join("");
    filtersEl.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      active = b.dataset.i;
      filtersEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
      await load();
    });
  }
}

if (document.body.dataset.pipeline) loadPage(document.body.dataset.pipeline);
