import assert from "node:assert/strict";
import { costOf, monthlyCosts } from "./costs.js";
import { checkDuplicate, dedupeKey, titleSimilarity } from "./dedupe.js";
import { guardrailViolation } from "./guardrails.js";
import { tagIndustries } from "./industries.js";
import { LlmHttpError, normalizeBaseUrl } from "./llm.js";
import { isTradeRelevant } from "./relevance.js";
import { classify } from "./summarize.js";
import { isJunkTitle, parseDate, rowIsValid, runChannel } from "./sources/common.js";
import { parseFeed } from "./sources/rss.js";
import type { CostEntry, Post, RawItem, SeenEntry } from "./types.js";

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function notice(over: Partial<RawItem> = {}): RawItem {
  return {
    pipeline: "notifications",
    source: "dgft",
    channel: "dgft-notifications",
    sourceRef: "Notification 36/2026-27",
    title: "De minimis exemption from Registration-cum-Membership Certificate requirements",
    date: "2026-09-15",
    sourceUrl: "https://content.dgft.gov.in/Website/dgftprod/abc-123/Eng.pdf",
    rawSubject: "x",
    ...over,
  };
}

console.log("\n--- LLM failure classification ---");
check("a bad key or model is fatal, so the cycle stops", () => {
  for (const status of [400, 401, 402, 403, 404]) {
    assert.deepEqual(classify(new LlmHttpError("x", status)), { kind: "transient", fatal: true });
  }
});
check("rate limits and 5xx are retryable, not fatal", () => {
  for (const status of [429, 500, 502, 503]) {
    assert.deepEqual(classify(new LlmHttpError("x", status)), { kind: "transient", fatal: false });
  }
});
check("a network failure is transient; a bad JSON body or code bug is not", () => {
  assert.deepEqual(classify(new TypeError("fetch failed")), { kind: "transient", fatal: false });
  assert.deepEqual(classify(new SyntaxError("Unexpected token")), { kind: "quality" });
  assert.deepEqual(classify(new TypeError("Cannot read properties of undefined")), { kind: "quality" });
});

console.log("\n--- news relevance ---");
const news = (title: string, bodyText?: string): RawItem =>
  notice({ pipeline: "news", source: "rss", title, bodyText, sourceUrl: "https://example.com/a" });
check("a trade story is kept", () => {
  assert.equal(isTradeRelevant(news("India's steel exports rise as tariff worries ease")), true);
});
check("an off-topic business story is dropped", () => {
  assert.equal(isTradeRelevant(news("Titan open to acquiring smaller watch brands, sees strong growth")), false);
  assert.equal(isTradeRelevant(news("Home loan rates in Sept start at 7%: top lenders compared")), false);
});
check("the feed description counts, not just the title", () => {
  assert.equal(isTradeRelevant(news("Govt announces new scheme", "It will support exporters in Kerala.")), true);
});
check("keywords match whole words, not substrings", () => {
  assert.equal(isTradeRelevant(news("Airport terminal opens", "Passenger transport report")), false);
  assert.equal(isTradeRelevant(news("Tea board news", "Rapport with partners improves")), false);
});

console.log("\n--- date parsing ---");
check("dd/mm/yyyy is read as Indian order, not US", () => {
  assert.equal(parseDate("14/09/2026"), "2026-09-14");
});
check("two-digit year expands to 20xx", () => {
  assert.equal(parseDate("03-01-25"), "2025-01-03");
});
check("ISO-8601 is not mangled by the dd/mm/yyyy branch", () => {
  // The dd/mm/yyyy regex matches "26-09-07" inside this and would yield 2007-09-26.
  assert.equal(parseDate("2026-09-07T00:00:00Z"), "2026-09-07");
  assert.equal(parseDate("2026-09-07"), "2026-09-07");
});
check("RFC-822 pubDate parses", () => {
  assert.equal(parseDate("Wed, 16 Sep 2026 10:00:00 +0530"), "2026-09-16");
});
check("unparseable date does not throw", () => {
  assert.match(parseDate("garbage"), /^\d{4}-\d{2}-\d{2}$/);
});

console.log("\n--- junk titles ---");
check("link text is rejected as a title", () => {
  assert.equal(isJunkTitle("Download"), true);
  assert.equal(isJunkTitle("View Link"), true);
  assert.equal(isJunkTitle("Type : PDF"), true);
});
check("a real subject line is kept", () => {
  assert.equal(isJunkTitle("Amendment in the Export Policy of Wheat Flour - reg."), false);
});

console.log("\n--- row shape validation ---");
check("a well-formed notice row is valid", () => {
  assert.equal(rowIsValid(notice()), true);
});
check("a notice number with no digit is rejected (column shift)", () => {
  assert.equal(rowIsValid(notice({ sourceRef: "Sl." })), false);
});
check("a too-short title is rejected (wrong cell)", () => {
  assert.equal(rowIsValid(notice({ title: "PDF" })), false);
});
check("news is keyed on URL, not a notice number", () => {
  const item = notice({
    pipeline: "news",
    source: "rss",
    sourceRef: "https://example.com/story",
    sourceUrl: "https://example.com/story",
  });
  assert.equal(rowIsValid(item), true);
});

console.log("\n--- dedupe keys ---");
check("notice number normalises punctuation and case", () => {
  assert.equal(
    dedupeKey(notice({ sourceRef: "Notification No. 36/2026-27" })),
    dedupeKey(notice({ sourceRef: "notification no 36 / 2026 27" })),
  );
});
check("a DGFT re-upload under a new UUID path is still the same notice", () => {
  const a = notice({ sourceUrl: "https://content.dgft.gov.in/Website/dgftprod/uuid-A/f.pdf" });
  const b = notice({ sourceUrl: "https://content.dgft.gov.in/Website/dgftprod/uuid-B/f.pdf" });
  assert.equal(dedupeKey(a), dedupeKey(b));
});
check("different notices get different keys", () => {
  assert.notEqual(
    dedupeKey(notice({ sourceRef: "Notification 36/2026-27" })),
    dedupeKey(notice({ sourceRef: "Notification 37/2026-27" })),
  );
});
check("news URL key ignores tracking params and trailing slash", () => {
  const a = notice({ pipeline: "news", sourceUrl: "https://ex.com/a/?utm_source=x" });
  const b = notice({ pipeline: "news", sourceUrl: "https://ex.com/a" });
  assert.equal(dedupeKey(a), dedupeKey(b));
});

console.log("\n--- title similarity ---");
check("a corrigendum of the same notice scores above threshold", () => {
  const score = titleSimilarity(
    "Amendment in the Export Policy of Wheat Flour and related products",
    "Amendment in Export Policy of Wheat Flour and related products - corrigendum",
  );
  assert.ok(score >= 0.72, `expected >= 0.72, got ${score.toFixed(2)}`);
});
check("two unrelated notices score below threshold", () => {
  const score = titleSimilarity(
    "Amendment in the Export Policy of Wheat Flour",
    "Introduction of Open API Integration for Certificate of Origin",
  );
  assert.ok(score < 0.72, `expected < 0.72, got ${score.toFixed(2)}`);
});

console.log("\n--- duplicate detection ---");
check("an item already in seen.json is a duplicate", () => {
  const item = notice();
  const seen: SeenEntry[] = [
    {
      key: dedupeKey(item),
      pipeline: "notifications",
      source: "dgft",
      sourceRef: item.sourceRef,
      title: item.title,
      firstSeenAt: new Date().toISOString(),
      outcome: "published",
    },
  ];
  assert.equal(checkDuplicate(item, seen, []).duplicate, true);
});
check("a skipped item is NOT retried forever - it is in seen.json too", () => {
  const item = notice();
  const seen: SeenEntry[] = [
    {
      key: dedupeKey(item),
      pipeline: "notifications",
      source: "dgft",
      sourceRef: item.sourceRef,
      title: item.title,
      firstSeenAt: new Date().toISOString(),
      outcome: "skipped-guardrail",
    },
  ];
  assert.equal(checkDuplicate(item, seen, []).duplicate, true);
});
check("a fresh item is not a duplicate", () => {
  assert.equal(checkDuplicate(notice(), [], []).duplicate, false);
});
check("a near-identical title published recently is caught", () => {
  const posts: Post[] = [
    {
      id: "p1",
      pipeline: "notifications",
      slug: "s",
      title: "Amendment in the Export Policy of Wheat Flour and related products",
      excerpt: "",
      body: "",
      impact: "",
      industries: [],
      tags: [],
      source: "dgft",
      sourceRef: "Notification 34/2026-27",
      publishedAt: new Date().toISOString(),
      sourceUrl: "",
      disclaimer: "",
      engine: "stub",
    },
  ];
  const item = notice({
    sourceRef: "Notification 99/2026-27",
    title: "Amendment in Export Policy of Wheat Flour and related products - corrigendum",
  });
  assert.equal(checkDuplicate(item, [], posts).duplicate, true);
});
check("an old post beyond the 90-day window does not block a new item", () => {
  const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
  const posts: Post[] = [
    {
      id: "p1",
      pipeline: "notifications",
      slug: "s",
      title: "Amendment in the Export Policy of Wheat Flour and related products",
      excerpt: "", body: "", impact: "", industries: [], tags: [],
      source: "dgft", sourceRef: "Notification 34/2026-27",
      publishedAt: old, sourceUrl: "", disclaimer: "", engine: "stub",
    },
  ];
  const item = notice({
    sourceRef: "Notification 99/2026-27",
    title: "Amendment in Export Policy of Wheat Flour and related products - corrigendum",
  });
  assert.equal(checkDuplicate(item, [], posts).duplicate, false);
});

console.log("\n--- feed parsing ---");
check("RSS 2.0 items parse", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <title>Trade Wire</title>
    <item>
      <title>India revises pre-shipment inspection timelines</title>
      <link>https://example.com/story-one</link>
      <pubDate>Wed, 16 Sep 2026 10:00:00 +0530</pubDate>
      <description>DGFT has extended the window for backlog certificates.</description>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml, { id: "tw", label: "Trade Wire", url: "https://example.com/feed" });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.sourceUrl, "https://example.com/story-one");
  assert.equal(items[0]!.date, "2026-09-16");
  assert.equal(items[0]!.pipeline, "news");
  assert.match(items[0]!.rawSubject, /backlog certificates/);
});
check("Atom entries parse, taking link from the href attribute", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Customs portal adds open API for certificates of origin</title>
      <link href="https://example.com/atom-story"/>
      <published>2026-09-07T00:00:00Z</published>
      <summary>Exporters can now integrate directly.</summary>
    </entry>
  </feed>`;
  const items = parseFeed(xml, { id: "at", label: "Atom", url: "https://example.com/atom" });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.sourceUrl, "https://example.com/atom-story");
  assert.equal(items[0]!.date, "2026-09-07");
});
check("an entry with no link is dropped rather than published linkless", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Headline with no link at all here</title></item>
  </channel></rss>`;
  assert.equal(parseFeed(xml, { id: "x", label: "X", url: "u" }).length, 0);
});
check("the limit is respected", () => {
  const items = Array.from({ length: 30 }, (_, i) =>
    `<item><title>Story number ${i} about trade policy</title><link>https://ex.com/${i}</link></item>`,
  ).join("");
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;
  assert.equal(parseFeed(xml, { id: "x", label: "X", url: "u" }, 5).length, 5);
});

console.log("\n--- LLM base URL ---");
check("a trailing slash does not produce a double-slash request URL", () => {
  assert.equal(normalizeBaseUrl("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1");
});
check("no trailing slash is left unchanged", () => {
  assert.equal(normalizeBaseUrl("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1");
});

console.log("\n--- guardrails ---");
check("a stated duty percentage is rejected", () => {
  assert.notEqual(guardrailViolation("duty is 10%"), null);
  assert.notEqual(guardrailViolation("The customs duty of 12.5% applies"), null);
  assert.notEqual(guardrailViolation("a 5% BCD now applies"), null);
});
check("a legal conclusion is rejected", () => {
  assert.notEqual(guardrailViolation("You are legally required to amend the filing."), null);
  assert.notEqual(guardrailViolation("This constitutes legal advice."), null);
  assert.notEqual(guardrailViolation("Clearance is guaranteed to complete."), null);
});
check("a hard compliance deadline is rejected", () => {
  assert.notEqual(guardrailViolation("You must comply by 31/03/2026."), null);
  assert.notEqual(guardrailViolation("The deadline is 15-04-26 for all filings."), null);
});
check("claiming every client is affected is rejected", () => {
  assert.notEqual(guardrailViolation("All our clients are affected by this change."), null);
});
check("a clean paragraph passes", () => {
  assert.equal(
    guardrailViolation(
      "DGFT has revised the timeline for issuing pre-shipment inspection certificates. " +
        "If you import scrap through Cochin, check whether your PSIA registration is current. " +
        "Open the official notice and confirm the position with Neo's CHA before filing.",
    ),
    null,
  );
});
check("the violation reason names the offending text", () => {
  const reason = guardrailViolation("duty is 10%");
  assert.match(reason ?? "", /duty percentage/);
  assert.match(reason ?? "", /10%/);
});

console.log("\n--- industry tagging ---");
check("keywords in the text are matched", () => {
  assert.deepEqual(tagIndustries("Export policy for cashew kernel shipments", []), ["cashew"]);
});
check("model tags and keyword hits are unioned without duplicates", () => {
  const tags = tagIndustries("Steel billet import policy", ["steel", "Steel", "steel"]);
  assert.deepEqual(tags, ["steel"]);
  assert.equal(new Set(tags).size, tags.length);
});
check("an industry the model invented is discarded", () => {
  assert.deepEqual(tagIndustries("A general trade circular about filings", ["unicorns"]), [
    "general-trade",
  ]);
});
check("nothing matched falls back to general-trade", () => {
  assert.deepEqual(tagIndustries("A procedural circular about portal downtime", []), [
    "general-trade",
  ]);
});
check("general-trade is dropped once a real industry matches", () => {
  const tags = tagIndustries("Cashew kernel policy", ["general-trade", "cashew"]);
  assert.deepEqual(tags, ["cashew"]);
});
check("keywords match whole words, not substrings", () => {
  // "ore" must not fire on "regarding"/"issuance"; "tea" must not fire on "instead".
  assert.deepEqual(
    tagIndustries("Revision in timeline for issuance of PSIC - regarding", []),
    ["general-trade"],
  );
  assert.deepEqual(tagIndustries("Guidance issued instead of a circular", []), ["general-trade"]);
});
check("a multi-word keyword still matches across whitespace", () => {
  assert.ok(tagIndustries("Export of iron   ore fines", []).includes("mining"));
});
check("a genuine mining notice is still tagged", () => {
  assert.ok(tagIndustries("Policy for import of bauxite ore", []).includes("mining"));
});

console.log("\n--- costs ---");
check("the stub model costs nothing", () => {
  assert.equal(costOf("stub", 5000, 2000), 0);
});
check("an unpriced model (e.g. gpt-4o-mini, not in the table yet) yields null, not a wrong number", () => {
  assert.equal(costOf("openai/gpt-4o-mini", 1000, 1000), null);
});
check("monthly aggregate groups by model and pipeline", () => {
  const rows: CostEntry[] = [
    { id: "1", pipeline: "notifications", postId: null, sourceRef: "a", model: "openai/gpt-4o-mini",
      inputTokens: 1000, outputTokens: 500, costUsd: null, createdAt: "2026-09-01T00:00:00Z" },
    { id: "2", pipeline: "news", postId: null, sourceRef: "b", model: "openai/gpt-4o-mini",
      inputTokens: 2000, outputTokens: 1000, costUsd: null, createdAt: "2026-09-02T00:00:00Z" },
    { id: "3", pipeline: "news", postId: null, sourceRef: "c", model: "openai/gpt-4o-mini",
      inputTokens: 9, outputTokens: 9, costUsd: null, createdAt: "2026-08-31T00:00:00Z" },
  ];
  const m = monthlyCosts("2026-09", rows);
  assert.equal(m.calls, 2, "August row must be excluded");
  assert.equal(m.totalTokens, 4500);
  assert.equal(m.byModel["openai/gpt-4o-mini"]?.calls, 2);
  assert.equal(m.byPipeline["news"]?.calls, 1);
  assert.equal(m.byPipeline["notifications"]?.calls, 1);
});
check("an unpriced call is flagged so the total is not read as complete", () => {
  const rows: CostEntry[] = [
    { id: "1", pipeline: "blogs", postId: null, sourceRef: "a", model: "mystery",
      inputTokens: 100, outputTokens: 50, costUsd: null, createdAt: "2026-09-01T00:00:00Z" },
  ];
  const m = monthlyCosts("2026-09", rows);
  assert.equal(m.hasUnpriced, true);
  assert.equal(m.totalTokens, 150, "tokens are still recorded for an unpriced model");
});

// Async checks run last so the sync output above stays ordered.
const asyncChecks = async (): Promise<void> => {
  console.log("\n--- channel isolation (async) ---");

  const thrower = await runChannel("boom", "notifications", async () => {
    throw new Error("HTTP 503 for https://example.gov.in");
  });
  check("a throwing channel is reported unhealthy, not propagated", () => {
    assert.equal(thrower.health.ok, false);
    assert.equal(thrower.items.length, 0);
    assert.match(thrower.health.error ?? "", /503/);
  });

  // Simulates a government page that gained or lost a column: rows parse, but the
  // values land in the wrong fields. This must contribute nothing.
  const shifted = await runChannel("column-shift", "notifications", async () =>
    Array.from({ length: 10 }, (_, i) =>
      notice({ sourceRef: "Sl.", title: `Download ${i}` }),
    ),
  );
  check("a column-shifted channel contributes zero rows", () => {
    assert.equal(shifted.items.length, 0);
    assert.equal(shifted.health.ok, false);
    assert.match(shifted.health.error ?? "", /shape check failed/);
  });

  const healthy = await runChannel("good", "notifications", async () => [notice()]);
  check("a healthy channel passes rows through", () => {
    assert.equal(healthy.items.length, 1);
    assert.equal(healthy.health.ok, true);
  });

  console.log(
    `\n${passed} checks passed${process.exitCode ? " (with failures above)" : ""}.\n`,
  );
};

await asyncChecks();
