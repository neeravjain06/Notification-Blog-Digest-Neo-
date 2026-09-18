import { industries } from "./config.js";
import type { Pipeline, RawItem } from "./types.js";

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    excerpt: { type: "string" },
    body: { type: "string" },
    impact: { type: "string" },
    industries: { type: "array", items: { type: "string" } },
  },
  required: ["title", "excerpt", "body", "impact", "industries"],
  additionalProperties: false,
} as const;

const SYSTEM =
  "You write for Neo Logistics' Media Center - desk notes that busy Indian importers and " +
  "exporters (Cochin and Chennai CHA clients) actually open. Return only valid JSON matching " +
  "the requested schema.";

/** VOICE and RULES blocks ported from the old summarize.ts buildDigestPrompt(). */
function sharedRules(): string {
  const list = industries.map((i) => `${i.id} (${i.label})`).join(", ");
  return `VOICE
- Sound like a sharp ops manager briefing a client over chai - not ChatGPT, not a government rewrite, not SEO spam.
- Specific. Name goods and processes when the source allows it.
- Calm confidence. Short paragraphs. One idea per paragraph.
- Ban filler: "In today's dynamic trade landscape", "It is important to note", "stakeholders", "leverage", "delve", "comprehensive", "robust", "stay ahead", "Learn about", "streamline", "aren't fully detailed", "It's advisable", "navigate the complexities", "game-changer".
- Ban title starters: "New...", "Important...", "Latest...", "What You Need to Know".
- Title = a business headline a CFO would open (max ~90 chars).

RULES
- Summarise ONLY what is in the source text. Invent nothing.
- Do NOT state a duty percentage, price, deadline, or compliance obligation as fact.
- Do NOT give legal conclusions or say anything is legally binding or guaranteed.
- Always route specifics back to the official source link.
- Do NOT pretend every Neo client is affected.
- Tag industries ONLY from this list: ${list}
- If unsure which industry: use "general-trade".
- excerpt: one hook sentence, max 180 chars.
- impact: 1-2 sentences - who should care plus the single next action.`;
}

function sourceBlock(item: RawItem): string {
  const body = item.bodyText
    ? `\nOFFICIAL TEXT EXCERPT (ground every fact here; do not go beyond it):\n${item.bodyText.slice(0, 4200)}\n`
    : `\n(No full text fetched - write carefully from the subject. Be honest about what is confirmed versus what Neo's CHA must verify.)\n`;

  return `SOURCE
Source: ${item.source}
Channel: ${item.channel}
Reference: ${item.sourceRef}
Date: ${item.date}
Subject: ${item.rawSubject}
URL: ${item.sourceUrl}
${body}`;
}

const STRUCTURE: Record<Pipeline, string> = {
  notifications: `STRUCTURE (markdown body, 220-380 words)
## What changed
2-4 sentences: what CBIC or DGFT actually did, in plain English.

## Why it matters for shipments
The concrete filing, documentation or timing angle. Name Neo trades only when justified. If it is unclear who is affected, say so.

## What to do next
Exactly 3 bullets:
1) Open the official notice
2) Check whether your CTH, documents or policy line is touched
3) Ask Neo's CHA before changing Bill of Entry or Shipping Bill practice`,

  news: `STRUCTURE (markdown body, 120-180 words)
No headings. Two or three short paragraphs: what happened, and the one angle that matters to an Indian importer or exporter. Close by pointing at the original publication for detail. Do not restate the headline as the first sentence.`,

  blogs: `STRUCTURE (markdown body, 700-1100 words)
Open with a concrete situation a Cochin or Chennai trader would recognise. Then 3-4 "##" sections developing the topic. Close with what to watch next.
Where recent notifications are supplied as context, reference only the ones genuinely relevant to the topic - do not list them all.
This is commentary, not a notice summary: no "What changed" heading, no official-notice framing.`,
};

export function buildPrompt(item: RawItem): { system: string; user: string } {
  return {
    system: SYSTEM,
    user: `${sharedRules()}

${STRUCTURE[item.pipeline]}

${sourceBlock(item)}`,
  };
}
