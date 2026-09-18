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

function num(name: string, fallback: number): number {
  const raw = str(name);
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
const apiKey = str("AI_API_KEY");
const adminToken = str("ADMIN_TOKEN");

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

if (provider !== "stub" && !apiKey) {
  fail(
    `AI_PROVIDER is "${provider}" but AI_API_KEY is empty.\n` +
      "        A real provider without a key is a misconfiguration. Either supply the key,\n" +
      "        or set AI_PROVIDER=stub to run the offline summariser.",
  );
}

export const config = {
  port: num("PORT", 8791),

  aiProvider: provider,
  aiApiKey: apiKey,
  aiModel: str("AI_MODEL"),

  scanIntervalHours: num("SCAN_INTERVAL_HOURS", 24),
  blogIntervalHours: num("BLOG_INTERVAL_HOURS", 168),
  maxPublishPerDay: num("MAX_PUBLISH_PER_DAY", 5),
  minOkChannels: num("MIN_OK_CHANNELS", 2),

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
