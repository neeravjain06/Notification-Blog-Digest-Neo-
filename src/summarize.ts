import { randomUUID } from "node:crypto";
import { recordUsage } from "./costs.js";
import { guardrailViolation } from "./guardrails.js";
import { tagIndustries } from "./industries.js";
import { callModel } from "./llm.js";
import { PIPELINES } from "./pipelines.js";
import { buildPrompt, DRAFT_SCHEMA } from "./prompts.js";
import type { Draft, Post, RawItem } from "./types.js";

const MAX_ATTEMPTS = 2;

export type SummarizeResult =
  | { ok: true; post: Post }
  | { ok: false; outcome: "skipped-quality" | "skipped-guardrail"; reason: string };

function parseDraft(json: Record<string, unknown>): Draft | null {
  const { title, excerpt, body, impact, industries } = json;
  if (
    typeof title !== "string" ||
    typeof excerpt !== "string" ||
    typeof body !== "string" ||
    typeof impact !== "string"
  ) {
    return null;
  }
  if (!title.trim() || body.trim().length < 40) return null;
  return {
    title: title.trim(),
    excerpt: excerpt.trim(),
    body: body.trim(),
    impact: impact.trim(),
    industries: Array.isArray(industries) ? industries.filter((i): i is string => typeof i === "string") : [],
  };
}

function slugify(title: string, sourceRef: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  const suffix = sourceRef
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return suffix ? `${base}-${suffix}` : base;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Returns a publishable Post, or an explanation of why the item was dropped.
 *
 * On total failure the item is skipped and logged, never published. There is no
 * template fallback: the old repo emitted a canned skeleton when the model failed,
 * which is exactly the malformed-content outcome this build exists to avoid.
 */
export async function summarize(item: RawItem): Promise<SummarizeResult> {
  const { system, user } = buildPrompt(item);
  let lastReason = "no attempt made";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await callModel(system, user, DRAFT_SCHEMA, item);

      // Usage is recorded for every call, including ones whose output we reject -
      // a rejected draft still costs money and must show up in the ledger.
      recordUsage({
        pipeline: item.pipeline,
        postId: null,
        sourceRef: item.sourceRef,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      const draft = parseDraft(result.json);
      if (!draft) {
        lastReason = "model returned an incomplete or malformed draft";
        continue;
      }

      const violation = guardrailViolation(`${draft.title}\n${draft.excerpt}\n${draft.body}\n${draft.impact}`);
      if (violation) {
        lastReason = violation;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(500 * attempt);
          continue;
        }
        return { ok: false, outcome: "skipped-guardrail", reason: violation };
      }

      const tags = tagIndustries(`${draft.title} ${draft.body}`, draft.industries);

      return {
        ok: true,
        post: {
          id: randomUUID(),
          pipeline: item.pipeline,
          slug: slugify(draft.title, item.sourceRef),
          title: draft.title,
          excerpt: draft.excerpt,
          body: draft.body,
          impact: draft.impact,
          industries: tags,
          tags,
          source: item.source,
          sourceRef: item.sourceRef,
          publishedAt: new Date().toISOString(),
          sourceUrl: item.sourceUrl,
          disclaimer: PIPELINES[item.pipeline].disclaimer,
          engine: result.model,
        },
      };
    } catch (err) {
      lastReason = err instanceof Error ? err.message : String(err);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
  }

  return { ok: false, outcome: "skipped-quality", reason: lastReason };
}
