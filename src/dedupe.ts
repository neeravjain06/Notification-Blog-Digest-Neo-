import type { Post, RawItem, SeenEntry } from "./types.js";

/**
 * The identity key for an item. Deliberately NOT derived from the source URL: the old
 * scheme hashed the URL in, so a DGFT re-upload under a new UUID path read as a brand
 * new notice and got republished.
 */
export function dedupeKey(item: RawItem): string {
  switch (item.pipeline) {
    case "notifications": {
      const no = item.sourceRef
        .toLowerCase()
        .replace(/[^a-z0-9/]/g, "")
        .replace(/\/+/g, "/");
      return `${item.source}:${no}`;
    }
    case "news":
      return `news:${normalizeUrl(item.sourceUrl)}`;
    case "blogs":
      return `blog:${item.sourceRef}`;
  }
}

/** Strips query and fragment so tracking params don't mint a new identity for one article. */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.toLowerCase().trim();
  }
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "by", "with",
  "regarding", "reg", "dated", "no", "notification", "circular", "notice",
]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** Jaccard-ish overlap: shared tokens as a fraction of the smaller title. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

const SIMILARITY_THRESHOLD = 0.72;
const LOOKBACK_DAYS = 90;

export type DuplicateCheck = { duplicate: false } | { duplicate: true; reason: string };

export function checkDuplicate(item: RawItem, seen: SeenEntry[], posts: Post[]): DuplicateCheck {
  const key = dedupeKey(item);

  if (seen.some((s) => s.key === key)) {
    return { duplicate: true, reason: `already processed (key ${key})` };
  }

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  for (const post of posts) {
    if (post.pipeline !== item.pipeline) continue;
    const published = Date.parse(post.publishedAt);
    if (Number.isNaN(published) || published < cutoff) continue;

    const score = titleSimilarity(item.title, post.title);
    if (score >= SIMILARITY_THRESHOLD) {
      return {
        duplicate: true,
        reason: `title ${score.toFixed(2)} similar to published "${post.title}" (${post.sourceRef})`,
      };
    }
  }

  return { duplicate: false };
}
