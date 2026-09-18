import type { ChannelHealth, Pipeline, RawItem } from "../types.js";

/** Ported verbatim from the old scrape.ts - government sites 403 a bare fetch UA. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NeoDigest/3.0";

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-IN,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  // A 200 with a near-empty body means an interstitial or an outage, not real content.
  if (text.length < 400) throw new Error(`Response too small (${text.length}b) for ${url}`);
  return text;
}

/**
 * Indian government sites use dd/mm/yyyy, which Date.parse reads as mm/dd - hence the
 * explicit reordering below.
 *
 * ISO-8601 must be checked FIRST: the dd/mm/yyyy regex happily matches "26-09-07"
 * inside "2026-09-07T00:00:00Z" and yields 2007-09-26. RSS and Atom feeds carry ISO
 * timestamps, so this is a live path, not a theoretical one.
 */
export function parseDate(raw: string): string {
  const t = raw.trim();

  const iso8601 = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso8601) return `${iso8601[1]}-${iso8601[2]}-${iso8601[3]}`;

  const m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const dd = m[1]!.padStart(2, "0");
    const mm = m[2]!.padStart(2, "0");
    let yyyy = m[3]!;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = Date.parse(t);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/** Ported verbatim - these are the link-text strings that leak in as titles. */
export function isJunkTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 12) return true;
  if (/^download\b/i.test(t)) return true;
  if (/type\s*:\s*pdf/i.test(t)) return true;
  if (/^view\s*link$/i.test(t)) return true;
  if (/^attachment$/i.test(t)) return true;
  return false;
}

export function absUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Shape validation. The old scraper indexed columns blindly, so a government page
 * gaining or losing a column silently landed wrong text in sourceRef/title and the
 * run "succeeded" with garbage. A row that fails this is not trusted.
 *
 * What counts as a well-formed sourceRef differs by pipeline: a notice number always
 * contains a digit, a news article is identified by its URL, a blog by its topic id.
 */
export function rowIsValid(r: RawItem): boolean {
  const titleOk = r.title.length > 15 && !isJunkTitle(r.title);
  const dateOk = !Number.isNaN(Date.parse(r.date));
  if (!titleOk || !dateOk) return false;

  switch (r.pipeline) {
    case "notifications":
      return /\d/.test(r.sourceRef);
    case "news":
      return /^https?:\/\//i.test(r.sourceUrl);
    case "blogs":
      return r.sourceRef.length > 0;
  }
}

/** Below this share of valid rows, the page shape has probably changed. */
const VALID_ROW_RATIO_FLOOR = 0.6;

export type ChannelResult = { items: RawItem[]; health: ChannelHealth };

/**
 * Wraps a channel so it reports failure instead of throwing, and so a channel whose
 * parsed rows look structurally wrong contributes nothing rather than poisoning the run.
 */
export async function runChannel(
  channel: string,
  pipeline: Pipeline,
  fn: () => Promise<RawItem[]>,
): Promise<ChannelResult> {
  const t0 = Date.now();
  const base = { channel, pipeline };
  try {
    const parsed = await fn();
    const valid = parsed.filter(rowIsValid);
    const ratio = parsed.length === 0 ? 0 : valid.length / parsed.length;

    if (parsed.length > 0 && ratio < VALID_ROW_RATIO_FLOOR) {
      return {
        items: [],
        health: {
          ...base,
          ok: false,
          count: 0,
          latencyMs: Date.now() - t0,
          error: `shape check failed: only ${valid.length}/${parsed.length} rows valid (floor ${VALID_ROW_RATIO_FLOOR})`,
        },
      };
    }

    return {
      items: valid,
      health: {
        ...base,
        ok: valid.length > 0,
        count: valid.length,
        latencyMs: Date.now() - t0,
        error: valid.length ? undefined : "0 valid rows parsed",
      },
    };
  } catch (err) {
    return {
      items: [],
      health: {
        ...base,
        ok: false,
        count: 0,
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
