export type Pipeline = "notifications" | "news" | "blogs";

export type SourceName = "cbic" | "dgft" | "rss" | "topics";

/** An item pulled from a source, before any AI touches it. */
export type RawItem = {
  pipeline: Pipeline;
  source: SourceName;
  channel: string;
  /** Notice number, article URL, or topic id - whatever identifies this item at its source. */
  sourceRef: string;
  title: string;
  /** ISO yyyy-mm-dd */
  date: string;
  sourceUrl: string;
  /** Fuller text handed to the summariser: subject line, or fetched body when available. */
  rawSubject: string;
  bodyText?: string;
};

export type ChannelHealth = {
  channel: string;
  pipeline: Pipeline;
  ok: boolean;
  count: number;
  latencyMs: number;
  error?: string;
};

export type ScrapeBundle = {
  items: RawItem[];
  health: ChannelHealth[];
  okChannels: number;
  totalChannels: number;
};

/** What the model is asked to return. Mirrors the JSON schema in summarize.ts. */
export type Draft = {
  title: string;
  excerpt: string;
  body: string;
  impact: string;
  industries: string[];
};

export type Post = {
  id: string;
  pipeline: Pipeline;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  impact: string;
  industries: string[];
  tags: string[];
  source: SourceName;
  sourceRef: string;
  publishedAt: string;
  sourceUrl: string;
  disclaimer: string;
  /** Which summariser produced this. "stub" must never be mistaken for real copy. */
  engine: string;
};

export type Outcome =
  | "published"
  | "skipped-duplicate"
  | "skipped-quality"
  | "skipped-guardrail"
  | "skipped-cap"
  /** Network, rate-limit, 5xx or auth failure. Never written to seen.json - the item retries. */
  | "failed-transient";

export type SeenEntry = {
  key: string;
  pipeline: Pipeline;
  source: SourceName;
  sourceRef: string;
  title: string;
  firstSeenAt: string;
  outcome: Outcome;
  reason?: string;
  postId?: string;
};

export type CostEntry = {
  id: string;
  pipeline: Pipeline;
  postId: string | null;
  sourceRef: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** null when the model has no price-table entry - tokens are still recorded. */
  costUsd: number | null;
  createdAt: string;
};

export type PipelineState = {
  lastRunAt: string | null;
  lastError: string | null;
  publishedToday: number;
  dayKey: string;
  lastHealth: ChannelHealth[];
};

export type AppState = Record<Pipeline, PipelineState>;

export type Industry = {
  id: string;
  label: string;
  keywords: string[];
};

export type RssSource = {
  id: string;
  label: string;
  url: string;
};

export type BlogTopic = {
  id: string;
  title: string;
  angle: string;
};
