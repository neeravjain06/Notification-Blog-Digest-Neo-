import { config, rssSources } from "../config.js";
import type { ChannelHealth, Pipeline, RawItem, ScrapeBundle } from "../types.js";
import { scrapeCbicCirculars, scrapeCbicNotifications } from "./cbic.js";
import { runChannel, type ChannelResult } from "./common.js";
import { scrapeDgftCategory } from "./dgft.js";
import { scrapeRssFeed } from "./rss.js";
import { nextBlogTopic } from "./topics.js";

export class ReliabilityGateError extends Error {
  constructor(
    message: string,
    readonly health: ChannelHealth[],
  ) {
    super(message);
    this.name = "ReliabilityGateError";
  }
}

function channelsFor(pipeline: Pipeline): Array<Promise<ChannelResult>> {
  switch (pipeline) {
    case "notifications":
      return [
        runChannel("cbic-eccs-notifications", pipeline, () => scrapeCbicNotifications(20)),
        runChannel("cbic-eccs-circulars", pipeline, () => scrapeCbicCirculars(12)),
        runChannel("dgft-notifications", pipeline, () => scrapeDgftCategory(1, "dgft-notifications", 15)),
        runChannel("dgft-public-notices", pipeline, () => scrapeDgftCategory(2, "dgft-public-notices", 12)),
        runChannel("dgft-trade-notices", pipeline, () => scrapeDgftCategory(4, "dgft-trade-notices", 12)),
      ];
    case "news":
      return rssSources.map((src) => runChannel(`rss-${src.id}`, pipeline, () => scrapeRssFeed(src, 15)));
    case "blogs":
      return [runChannel("blog-topics", pipeline, () => nextBlogTopic(10))];
  }
}

/**
 * Runs every channel for a pipeline in parallel. Channels are isolated - one failing
 * never takes down the run - but if too few are healthy we abort rather than publish
 * a partial view of the world as though it were complete.
 */
export async function fetchPipeline(pipeline: Pipeline): Promise<ScrapeBundle> {
  const jobs = channelsFor(pipeline);
  if (!jobs.length) {
    return { items: [], health: [], okChannels: 0, totalChannels: 0 };
  }

  const results = await Promise.all(jobs);
  const health = results.map((r) => r.health);
  const okChannels = health.filter((h) => h.ok).length;

  // Single-channel pipelines can't meaningfully meet a >1 quorum; the gate only
  // applies where there are genuinely several independent sources to cross-check.
  const required = Math.min(config.minOkChannels, jobs.length);
  if (okChannels < required) {
    throw new ReliabilityGateError(
      `${pipeline}: only ${okChannels}/${jobs.length} channels healthy, need ${required}. ` +
        health.map((h) => `${h.channel}=${h.ok ? "ok" : h.error}`).join("; "),
      health,
    );
  }

  const seen = new Set<string>();
  const items: RawItem[] = [];
  for (const r of results) {
    for (const item of r.items) {
      const key = `${item.source}:${item.sourceRef}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  return { items, health, okChannels, totalChannels: jobs.length };
}
