import { config } from "./config.js";
import { runCycle } from "./cycle.js";
import { checkDuplicate, dedupeKey } from "./dedupe.js";
import { currentMonth, monthlyCosts } from "./costs.js";
import { isPipeline } from "./pipelines.js";
import { fetchPipeline, ReliabilityGateError } from "./sources/index.js";
import { readPosts, readSeen } from "./store.js";
import type { Pipeline } from "./types.js";

function parseArgs(argv: string[]): { pipelines: Pipeline[]; dry: boolean } {
  const dry = argv.includes("--dry");
  const arg = argv.find((a) => a.startsWith("--pipeline="));
  const requested = arg?.split("=")[1];

  if (!requested || requested === "all") {
    return { pipelines: [...config.enabledPipelines], dry };
  }
  if (!isPipeline(requested)) {
    console.error(`Unknown pipeline "${requested}". Valid: notifications, news, blogs, all`);
    process.exit(1);
  }
  return { pipelines: [requested], dry };
}

async function dryRun(pipeline: Pipeline): Promise<void> {
  console.log(`\n=== ${pipeline} (dry run - nothing is written or published) ===`);

  let bundle;
  try {
    bundle = await fetchPipeline(pipeline);
  } catch (err) {
    if (err instanceof ReliabilityGateError) {
      console.error(`ABORTED by reliability gate: ${err.message}`);
      return;
    }
    throw err;
  }

  console.log(`\nChannel health (${bundle.okChannels}/${bundle.totalChannels} ok):`);
  for (const h of bundle.health) {
    const status = h.ok ? `ok   ${String(h.count).padStart(3)} rows` : `FAIL          `;
    console.log(`  ${status}  ${h.channel.padEnd(28)} ${h.latencyMs}ms  ${h.error ?? ""}`);
  }

  const seen = readSeen();
  const posts = readPosts(pipeline);
  let fresh = 0;
  let dupes = 0;

  console.log(`\nItems (${bundle.items.length} relevant, ${bundle.filteredOut} filtered out as off-topic):`);
  for (const item of bundle.items) {
    const dup = checkDuplicate(item, seen, posts);
    if (dup.duplicate) {
      dupes++;
      console.log(`  [dup]  ${item.sourceRef} - ${dup.reason}`);
      continue;
    }
    fresh++;
    console.log(`  [new]  ${item.date}  ${item.sourceRef}`);
    console.log(`         ${item.title.slice(0, 100)}`);
    console.log(`         key=${dedupeKey(item)}`);
    console.log(`         ${item.sourceUrl}`);
  }

  console.log(`\nSummary: ${fresh} new, ${dupes} already seen.`);
}

async function fullRun(pipeline: Pipeline): Promise<void> {
  console.log(`\n=== ${pipeline} ===`);
  const report = await runCycle(pipeline);

  if (report.aborted) {
    console.error(`ABORTED: ${report.error}`);
    return;
  }

  console.log(`Parsed ${report.parsed} (+${report.filtered} filtered as off-topic), published ${report.published}.`);

  if (report.skipped.length) {
    console.log(`Skipped ${report.skipped.length}:`);
    for (const s of report.skipped) {
      console.log(`  [${s.outcome}] ${s.sourceRef} - ${s.reason}`);
    }
  }

  // Guard the slice: slice(-0) returns the whole array, which would print every
  // existing post on a run that published nothing.
  if (report.published > 0) {
    for (const post of readPosts(pipeline).slice(-report.published)) {
      console.log(`\n  --- ${post.title}`);
      console.log(`  engine=${post.engine} industries=${post.industries.join(",")}`);
      console.log(`  ${post.excerpt}`);
    }
  }
}

async function main(): Promise<void> {
  const { pipelines, dry } = parseArgs(process.argv.slice(2));

  for (const pipeline of pipelines) {
    if (dry) await dryRun(pipeline);
    else await fullRun(pipeline);
  }

  if (!dry) {
    const month = currentMonth();
    const c = monthlyCosts(month);
    console.log(
      `\nAI spend ${month}: ${c.calls} calls, ${c.totalTokens} tokens, $${c.totalUsd.toFixed(4)}` +
        (c.hasUnpriced ? " (some calls used an unpriced model - total understates)" : ""),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
