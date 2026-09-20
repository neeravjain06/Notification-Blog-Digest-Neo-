import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { currentMonth, monthlyCosts } from "./costs.js";
import { runCycle, type CycleReport } from "./cycle.js";
import { isPipeline, PIPELINES } from "./pipelines.js";
import { readPosts, readState } from "./store.js";
import type { Pipeline } from "./types.js";

// ponytail: single process, in-memory lock. The JSON store has no file locking, so two
// concurrent cycles would clobber each other's writes. Move to a real DB before scaling out.
let running: Pipeline | null = null;

async function runLocked(pipeline: Pipeline): Promise<CycleReport | "busy"> {
  if (running) return "busy";
  running = pipeline;
  try {
    return await runCycle(pipeline);
  } finally {
    running = null;
  }
}

function tokenMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!given || !tokenMatches(given)) {
    res.status(401).json({ error: "admin token required" });
    return;
  }
  next();
}

const app = express();

app.use(express.static("public", { extensions: ["html"] }));

// Public: what the site shows.
app.get("/api/posts/:pipeline", (req, res) => {
  const { pipeline } = req.params;
  if (!isPipeline(pipeline)) {
    res.status(404).json({ error: `unknown pipeline "${pipeline}"` });
    return;
  }
  const industry = typeof req.query.industry === "string" ? req.query.industry : "";
  const posts = readPosts(pipeline)
    .filter((p) => !industry || p.industries.includes(industry))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  res.json({ pipeline, label: PIPELINES[pipeline].label, count: posts.length, posts });
});

// Token-gated: operational detail and spend.
app.get("/api/status", requireAdmin, (_req, res) => {
  const state = readState();
  res.json({
    running,
    autoMachine: config.autoMachine,
    provider: config.aiProvider,
    model: config.aiProvider === "stub" ? "stub" : config.aiModel,
    maxPublishPerDay: config.maxPublishPerDay,
    pipelines: config.enabledPipelines.map((p) => ({
      pipeline: p,
      posts: readPosts(p).length,
      ...state[p],
    })),
  });
});

app.get("/api/costs", requireAdmin, (_req, res) => {
  res.json(monthlyCosts(currentMonth()));
});

app.post("/api/run/:pipeline", requireAdmin, async (req, res) => {
  const pipeline = req.params.pipeline ?? "";
  if (!isPipeline(pipeline) || !config.enabledPipelines.includes(pipeline)) {
    res.status(404).json({ error: `pipeline "${pipeline}" is unknown or not enabled` });
    return;
  }
  try {
    const report = await runLocked(pipeline);
    if (report === "busy") {
      res.status(409).json({ error: `a ${running} cycle is already running` });
      return;
    }
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function schedule(): void {
  for (const pipeline of config.enabledPipelines) {
    const hours = PIPELINES[pipeline].cadence === "blog" ? config.blogIntervalHours : config.scanIntervalHours;
    const tick = async (): Promise<void> => {
      try {
        const r = await runLocked(pipeline);
        if (r === "busy") console.log(`[scheduler] ${pipeline} skipped - another cycle is running`);
        else if (r.aborted) console.error(`[scheduler] ${pipeline} aborted: ${r.error}`);
        else console.log(`[scheduler] ${pipeline}: parsed ${r.parsed}, published ${r.published}`);
      } catch (err) {
        console.error(`[scheduler] ${pipeline} crashed:`, err);
      }
    };
    setTimeout(tick, config.bootDelayMs);
    setInterval(tick, hours * 60 * 60 * 1000);
    console.log(`[scheduler] ${pipeline} every ${hours}h (first run in ${config.bootDelayMs}ms)`);
  }
}

app.listen(config.port, () => {
  console.log(`neo-media-digest listening on http://localhost:${config.port}`);
  if (config.autoMachine) schedule();
  else console.log("[scheduler] off (DIGEST_AUTO_MACHINE not set) - use the Run buttons or `npm run once`");
});
