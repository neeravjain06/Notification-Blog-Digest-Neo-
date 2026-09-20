import { industries } from "./config.js";

const FALLBACK = "general-trade";

const VALID_IDS = new Set(industries.map((i) => i.id));

/**
 * Keywords must match whole words. A plain substring test makes "ore" fire on
 * "regarding" and "issuance", which tagged procedural notices as mining.
 * Interior spaces match any run of whitespace so "iron ore" survives line wrapping.
 */
export function keywordPattern(keyword: string): RegExp {
  const escaped = keyword
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

const MATCHERS = industries.map((i) => ({
  id: i.id,
  patterns: i.keywords.map(keywordPattern),
}));

/** Keyword match over the item's text. Keywords come from config, not compiled in. */
function fromText(text: string): string[] {
  return MATCHERS.filter((m) => m.patterns.some((re) => re.test(text))).map((m) => m.id);
}

/** Drops anything the model invented that isn't in the configured taxonomy. */
function fromModel(raw: string[]): string[] {
  return raw
    .map((r) => r.toLowerCase().trim().replace(/\s+/g, "-"))
    .filter((r) => VALID_IDS.has(r));
}

/**
 * Union of keyword hits and the model's own tags, deduped. The old repo shipped
 * visible duplicate tags because it concatenated these two lists without a Set.
 */
export function tagIndustries(text: string, modelTags: string[]): string[] {
  const merged = new Set([...fromText(text), ...fromModel(modelTags)]);
  merged.delete(FALLBACK);
  return merged.size ? [...merged] : [FALLBACK];
}
