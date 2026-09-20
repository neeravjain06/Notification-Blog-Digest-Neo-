import { newsKeywords } from "./config.js";
import { keywordPattern } from "./industries.js";
import type { RawItem } from "./types.js";

const PATTERNS = newsKeywords.map(keywordPattern);

/**
 * The news feeds are general business RSS, so most items (watch brands, home-loan rates,
 * schooling) mean nothing to an importer or exporter. Keeping only items that mention a
 * trade term stops them spending the daily publish cap and the LLM budget.
 * Matches the title and feed description with whole-word keywords from config/news-keywords.json.
 */
export function isTradeRelevant(item: RawItem): boolean {
  const text = `${item.title} ${item.bodyText ?? ""}`;
  return PATTERNS.some((re) => re.test(text));
}
