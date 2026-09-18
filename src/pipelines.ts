import type { Pipeline } from "./types.js";

/** Ported verbatim from neo-cha-assistant/notifications-digest/src/blog-store.ts */
export const NOTIFICATIONS_DISCLAIMER =
  "AI-generated customs awareness posts for Neo Logistics clients. " +
  "Summaries are educational only — not official CBIC/DGFT text, not duty quotes, not legal advice. " +
  "Always open the official source link and confirm with Neo's licensed CHA before acting on a shipment.";

const NEWS_DISCLAIMER =
  "AI-summarised trade news for Neo Logistics clients. " +
  "Summaries are educational only — not duty quotes, not legal advice, and not a substitute for the " +
  "original publication. Always open the source link and confirm with Neo's licensed CHA before acting on a shipment.";

const BLOGS_DISCLAIMER =
  "AI-drafted commentary for Neo Logistics clients. " +
  "Educational only — not duty quotes, not legal advice. " +
  "Confirm anything operational with Neo's licensed CHA before acting on a shipment.";

export type PipelineDef = {
  id: Pipeline;
  label: string;
  disclaimer: string;
  /** Hours between runs. Read from config at schedule time, not here. */
  cadence: "scan" | "blog";
};

export const PIPELINES: Record<Pipeline, PipelineDef> = {
  notifications: {
    id: "notifications",
    label: "Customs Notifications",
    disclaimer: NOTIFICATIONS_DISCLAIMER,
    cadence: "scan",
  },
  news: {
    id: "news",
    label: "News",
    disclaimer: NEWS_DISCLAIMER,
    cadence: "scan",
  },
  blogs: {
    id: "blogs",
    label: "Blogs",
    disclaimer: BLOGS_DISCLAIMER,
    cadence: "blog",
  },
};

export function isPipeline(value: string): value is Pipeline {
  return value === "notifications" || value === "news" || value === "blogs";
}
