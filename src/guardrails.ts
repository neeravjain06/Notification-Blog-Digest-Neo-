/**
 * Post-hoc enforcement. Prompt instructions are guidance, not a guarantee - these
 * regexes are the actual control. A violation REJECTS the draft (retry, then skip);
 * it never merely lowers a score, and it never gets published with a warning.
 */

const DUTY_PCT_RE =
  /\b(?:customs\s+)?duty\s+(?:is|at|of|about|around|=|:)?\s*\d{1,2}(?:\.\d+)?\s?%|\b\d{1,2}(?:\.\d+)?\s?%\s+(?:bcd|igst|duty|customs)/i;

const LEGAL_BINDING_RE =
  /\b(this\s+constitutes\s+legal\s+advice|you\s+are\s+legally\s+required|binding\s+legal|guaranteed(?:\s+to)?)\b/i;

const HARD_DEADLINE_RE =
  /\b(must\s+comply\s+by|deadline\s+is|effective\s+from)\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i;

const ALL_CLIENTS_RE =
  /\b(all\s+(?:our\s+)?(?:neo\s+)?clients\s+(?:are|will\s+be)\s+affected|every\s+(?:importer|exporter|client)\s+(?:is|will\s+be)\s+affected)\b/i;

const CHECKS: Array<{ re: RegExp; reason: string }> = [
  { re: DUTY_PCT_RE, reason: "states a duty percentage as fact" },
  { re: LEGAL_BINDING_RE, reason: "gives a legal conclusion or guarantee" },
  { re: HARD_DEADLINE_RE, reason: "states a hard compliance deadline as fact" },
  { re: ALL_CLIENTS_RE, reason: "claims every client is affected" },
];

/** Returns the reason for rejection, or null if the text is clean. */
export function guardrailViolation(text: string): string | null {
  for (const { re, reason } of CHECKS) {
    const m = text.match(re);
    if (m) return `${reason}: "${m[0].trim()}"`;
  }
  return null;
}
