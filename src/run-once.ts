import { config } from "./config.js";
import { checkDuplicate, dedupeKey } from "./dedupe.js";
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

  console.log(`\nItems (${bundle.items.length} parsed):`);
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

async function main(): Promise<void> {
  const { pipelines, dry } = parseArgs(process.argv.slice(2));

  for (const pipeline of pipelines) {
    if (dry) {
      await dryRun(pipeline);
    } else {
      console.error(
        `Full run for "${pipeline}" needs the summariser (Phase 2). Use --dry for now.`,
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
