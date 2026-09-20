import { randomUUID } from "node:crypto";
import { readCosts, writeCosts } from "./store.js";
import type { CostEntry, Pipeline } from "./types.js";

/**
 * USD per 1M tokens. Hand-maintained, and deliberately does not include OpenRouter's
 * gpt-4o / gpt-4o-mini rates yet - those change over time and vary by the underlying
 * provider OpenRouter routes to, and a wrong number silently baked into a client's cost
 * ledger is worse than an honest null. Add real verified rates here once the key is live
 * and you can pull them from https://openrouter.ai/models or the account's own billing.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  stub: { input: 0, output: 0 },
};

/** null for an unpriced model - tokens are still recorded rather than a wrong number. */
export function costOf(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function recordUsage(args: {
  pipeline: Pipeline;
  postId: string | null;
  sourceRef: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): CostEntry {
  const entry: CostEntry = {
    id: randomUUID(),
    pipeline: args.pipeline,
    postId: args.postId,
    sourceRef: args.sourceRef,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    costUsd: costOf(args.model, args.inputTokens, args.outputTokens),
    createdAt: new Date().toISOString(),
  };
  const all = readCosts();
  all.push(entry);
  writeCosts(all);
  return entry;
}

export type MonthlyCosts = {
  month: string;
  calls: number;
  totalTokens: number;
  totalUsd: number;
  /** True when some calls used a model with no price entry, so totalUsd understates. */
  hasUnpriced: boolean;
  byModel: Record<string, { calls: number; tokens: number; usd: number }>;
  byPipeline: Record<string, { calls: number; tokens: number; usd: number }>;
};

export function monthlyCosts(month: string, entries = readCosts()): MonthlyCosts {
  const rows = entries.filter((e) => e.createdAt.startsWith(month));
  const out: MonthlyCosts = {
    month,
    calls: rows.length,
    totalTokens: 0,
    totalUsd: 0,
    hasUnpriced: false,
    byModel: {},
    byPipeline: {},
  };

  for (const r of rows) {
    const tokens = r.inputTokens + r.outputTokens;
    const usd = r.costUsd ?? 0;
    if (r.costUsd === null) out.hasUnpriced = true;

    out.totalTokens += tokens;
    out.totalUsd += usd;

    const m = (out.byModel[r.model] ??= { calls: 0, tokens: 0, usd: 0 });
    m.calls++;
    m.tokens += tokens;
    m.usd += usd;

    const p = (out.byPipeline[r.pipeline] ??= { calls: 0, tokens: 0, usd: 0 });
    p.calls++;
    p.tokens += tokens;
    p.usd += usd;
  }

  out.totalUsd = Number(out.totalUsd.toFixed(6));
  return out;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
