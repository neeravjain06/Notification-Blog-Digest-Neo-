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

// publishedAt is the SOURCE's date (CBIC/DGFT notice date, RSS pubDate), stored as midnight UTC.
// Read the date straight from the string (no timezone shift) and print it CBIC-style: 30-Sep-2026.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return MONTHS[Number(m) - 1] ? `${d}-${MONTHS[Number(m) - 1]}-${y}` : String(iso);
};

// Values are what the API stores (CBIC's own filter names); labels are what the chips show.
const CATEGORY_LABELS = { Tariff: "Tariff", "Non Tariff": "Non-Tariff", "Anti Dumping Duty": "Anti-Dumping", DGFT: "DGFT" };

function card(p) {
  const stub = p.engine === "stub";
  const link = safeUrl(p.sourceUrl);
  return `<article class="card">
    <h2>${esc(p.title)}</h2>
    <div class="meta">${p.category ? `<span class="badge">${esc(CATEGORY_LABELS[p.category] ?? p.category)}</span> · ` : ""}Published ${esc(fmtDate(p.publishedAt))} · ${esc(p.sourceRef.length > 40 ? p.source : p.sourceRef)}
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
  const categoriesEl = document.getElementById("categories");
  let active = "";
  let category = "";

  async function load() {
    const params = new URLSearchParams();
    if (active) params.set("industry", active);
    if (category) params.set("category", category);
    const q = params.size ? `?${params}` : "";
    const res = await fetch(`/api/posts/${pipeline}${q}`);
    if (!res.ok) { postsEl.innerHTML = `<p class="muted">Failed to load (HTTP ${res.status}).</p>`; return; }
    const data = await res.json();
    postsEl.innerHTML = data.posts.length
      ? data.posts.map(card).join("")
      : q
        ? `<p class="muted">No posts in this filter yet.</p>`
        : `<p class="muted">No posts yet. Use "Run now" on the <a href="/">admin panel</a>.</p>`;
    return data.posts;
  }

  // Category chips are fixed (only notifications.html has the container), so an empty
  // category still shows - "nothing under Anti-Dumping yet" is useful to see.
  if (categoriesEl) {
    const cats = ["", ...Object.keys(CATEGORY_LABELS)];
    categoriesEl.innerHTML = cats
      .map((c) => `<button class="chip ${c === "" ? "on" : ""}" data-c="${esc(c)}">${esc(c ? CATEGORY_LABELS[c] : "All")}</button>`)
      .join("");
    categoriesEl.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      category = b.dataset.c;
      categoriesEl.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
      await load();
    });
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
