import assert from "node:assert/strict";
import { checkDuplicate, dedupeKey, titleSimilarity } from "./dedupe.js";
import { isJunkTitle, parseDate, rowIsValid, runChannel } from "./sources/common.js";
import type { Post, RawItem, SeenEntry } from "./types.js";

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

console.log("\n--- date parsing ---");
check("dd/mm/yyyy is read as Indian order, not US", () => {
  assert.equal(parseDate("14/09/2026"), "2026-09-14");
});
check("two-digit year expands to 20xx", () => {
  assert.equal(parseDate("03-01-25"), "2025-01-03");
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
