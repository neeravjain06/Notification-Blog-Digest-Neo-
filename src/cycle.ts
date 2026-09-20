import { config } from "./config.js";
import { checkDuplicate, dedupeKey } from "./dedupe.js";
import { fetchPipeline, ReliabilityGateError } from "./sources/index.js";
import {
  readPosts,
  readSeen,
  readState,
  writePosts,
  writeSeen,
  writeState,
} from "./store.js";
import { summarize } from "./summarize.js";
import type { Outcome, Pipeline, RawItem, SeenEntry } from "./types.js";

export type CycleReport = {
  pipeline: Pipeline;
  aborted: boolean;
  error?: string;
  parsed: number;
  /** Items dropped as off-topic before dedupe (news only). */
  filtered: number;
  published: number;
  skipped: Array<{ sourceRef: string; outcome: Outcome; reason: string }>;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function seenEntry(item: RawItem, outcome: Outcome, reason?: string, postId?: string): SeenEntry {
  return {
    key: dedupeKey(item),
    pipeline: item.pipeline,
    source: item.source,
    sourceRef: item.sourceRef,
    title: item.title,
    firstSeenAt: new Date().toISOString(),
    outcome,
    reason,
    postId,
  };
}

/**
 * One full pass for one pipeline: fetch, dedupe, summarise, guardrail, publish.
 * Anything that clears the guardrails is published immediately - there is no
 * approval step and nothing ever waits on a human.
 */
export async function runCycle(pipeline: Pipeline): Promise<CycleReport> {
  const report: CycleReport = {
    pipeline,
    aborted: false,
    parsed: 0,
    filtered: 0,
    published: 0,
    skipped: [],
  };

  const state = readState();
  const ps = state[pipeline];

  // Reset the daily publish counter when the day rolls over.
  if (ps.dayKey !== todayKey()) {
    ps.dayKey = todayKey();
    ps.publishedToday = 0;
  }

  let bundle;
  try {
    bundle = await fetchPipeline(pipeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.aborted = true;
    report.error = message;
    ps.lastRunAt = new Date().toISOString();
    ps.lastError = message;
    if (err instanceof ReliabilityGateError) ps.lastHealth = err.health;
    writeState(state);
    return report;
  }

  report.parsed = bundle.items.length;
  report.filtered = bundle.filteredOut;
  ps.lastHealth = bundle.health;

  const seen = readSeen();
  const posts = readPosts(pipeline);
  const newSeen: SeenEntry[] = [];

  for (const item of bundle.items) {
    const dup = checkDuplicate(item, [...seen, ...newSeen], posts);
    if (dup.duplicate) continue;

    if (ps.publishedToday >= config.maxPublishPerDay) {
      // Not recorded in seen.json - this item must be reconsidered tomorrow.
      report.skipped.push({
        sourceRef: item.sourceRef,
        outcome: "skipped-cap",
        reason: `daily cap of ${config.maxPublishPerDay} reached`,
      });
      continue;
    }

    const result = await summarize(item);

    if (!result.ok) {
      report.skipped.push({
        sourceRef: item.sourceRef,
        outcome: result.outcome,
        reason: result.reason,
      });
      if (result.outcome === "failed-transient") {
        // Not recorded in seen.json - the item retries next cycle. A fatal failure (bad
        // key, bad model, no credits) will fail every remaining item too, so stop now
        // rather than spending a call on each.
        if (result.fatal) {
          report.aborted = true;
          report.error = `LLM call failed and cannot be retried: ${result.reason}`;
          break;
        }
        continue;
      }
      newSeen.push(seenEntry(item, result.outcome, result.reason));
      continue;
    }

    posts.push(result.post);
    newSeen.push(seenEntry(item, "published", undefined, result.post.id));
    ps.publishedToday++;
    report.published++;
  }

  if (newSeen.length) writeSeen([...seen, ...newSeen]);
  if (report.published) writePosts(pipeline, posts);

  ps.lastRunAt = new Date().toISOString();
  ps.lastError = report.error ?? null;
  writeState(state);

  return report;
}
