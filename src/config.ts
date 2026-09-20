import fs from "node:fs";
import path from "node:path";
import type { BlogTopic, Industry, Pipeline, RssSource } from "./types.js";

// Node's built-in .env loader (>=20.12) - no dotenv dependency.
try {
  process.loadEnvFile();
} catch {
  // No .env file. Env may still come from the shell or the container.
}

const ALL_PIPELINES: Pipeline[] = ["notifications", "news", "blogs"];

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

/** Neo's scaffold prefixes this service's vars with DIGEST_; accept either spelling. */
function env(name: string): string {
  return str(`DIGEST_${name}`) || str(name);
}

function num(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    fail(`${name} must be a number, got "${raw}"`);
  }
  return n;
}

function fail(message: string): never {
  console.error(`\n[config] ${message}\n`);
  process.exit(1);
}

function loadJsonConfig<T>(file: string): T[] {
  const full = path.resolve("config", file);
  try {
    const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!Array.isArray(parsed)) fail(`config/${file} must contain a JSON array`);
    return parsed as T[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") fail(`config/${file} is missing`);
    fail(`config/${file} is not valid JSON: ${e.message}`);
  }
}

const provider = str("AI_PROVIDER", "stub");
// Matches the field names in Neo's real scaffold env file: OpenRouter, an
// OpenAI-compatible REST API, is the actual provider - not a guess.
const apiKey = str("OPENAI_API_KEY");
const baseUrl = str("OPENAI_BASE_URL", "https://openrouter.ai/api/v1");
// DIGEST_AI_MODEL is this service's own override in the scaffold; AI_MODEL is the
// shared default other services in that scaffold also read.
const aiModel = str("DIGEST_AI_MODEL") || str("AI_MODEL");
const adminToken = env("ADMIN_TOKEN");

const enabledRaw = str("ENABLED_PIPELINES", ALL_PIPELINES.join(","));
const enabled = enabledRaw
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean) as Pipeline[];

for (const p of enabled) {
  if (!ALL_PIPELINES.includes(p)) {
    fail(`ENABLED_PIPELINES contains unknown pipeline "${p}". Valid: ${ALL_PIPELINES.join(", ")}`);
  }
}

if (!adminToken) {
  fail(
    "ADMIN_TOKEN is required and must be non-empty.\n" +
      "        The admin endpoints are token-gated with no open default - set it in .env.",
  );
}

if (provider !== "stub" && provider !== "openai") {
  fail(`AI_PROVIDER must be "stub" or "openai", got "${provider}"`);
}

if (provider !== "stub" && !apiKey) {
  fail(
    `AI_PROVIDER is "${provider}" but OPENAI_API_KEY is empty.\n` +
      "        A real provider without a key is a misconfiguration. Either supply the key,\n" +
      "        or set AI_PROVIDER=stub to run the offline summariser.",
  );
}

if (provider !== "stub" && !aiModel) {
  fail(
    `AI_PROVIDER is "${provider}" but no model is set (DIGEST_AI_MODEL or AI_MODEL).\n` +
      "        Without this every summarise call fails at runtime and every item is silently\n" +
      "        skipped - catch it here instead of in the skip log.",
  );
}

export const config = {
  // NOT PORT: in the scaffold .env that is the main app's port (8787).
  port: Number(str("NOTIFICATIONS_DIGEST_PORT", "8791")),

  aiProvider: provider,
  aiApiKey: apiKey,
  aiBaseUrl: baseUrl,
  aiModel,

  scanIntervalHours: num("SCAN_INTERVAL_HOURS", 24),
  blogIntervalHours: num("BLOG_INTERVAL_HOURS", 168),
  maxPublishPerDay: num("MAX_PUBLISH_PER_DAY", 5),
  minOkChannels: num("MIN_OK_CHANNELS", 2),

  autoMachine: ["1", "true", "yes"].includes(str("DIGEST_AUTO_MACHINE").toLowerCase()),
  bootDelayMs: num("BOOT_DELAY_MS", 15000),

  adminToken,
  publishExportDir: str("PUBLISH_EXPORT_DIR"),
  enabledPipelines: enabled,
} as const;

export const industries = loadJsonConfig<Industry>("industries.json");
export const rssSources = loadJsonConfig<RssSource>("sources.json");
export const blogTopics = loadJsonConfig<BlogTopic>("blog-topics.json");

if (config.aiProvider === "stub") {
  console.warn(
    "[config] AI_PROVIDER=stub - summaries are MECHANICAL PLACEHOLDER TEXT, not publishable copy. " +
      "Every post produced in this mode is tagged engine:\"stub\".",
  );
}
