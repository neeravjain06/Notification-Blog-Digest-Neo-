import fs from "node:fs";
import path from "node:path";
import type {
  AppState,
  CostEntry,
  Pipeline,
  PipelineState,
  Post,
  SeenEntry,
} from "./types.js";

const DATA_DIR = path.resolve("data");

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function dataPath(file: string): string {
  return path.join(DATA_DIR, file);
}

/**
 * Write via temp file + rename so a crash mid-write can never leave a half-written
 * JSON file behind. rename is atomic within a filesystem.
 */
export function writeJson(file: string, data: unknown): void {
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Never throws. A missing or corrupt file yields the fallback and a loud log, because
 * a bad data file must not stop the service from booting.
 */
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      console.error(
        `[store] ${file} is unreadable (${e.message}). Falling back to default. ` +
          `The file is NOT being repaired automatically - inspect it.`,
      );
    }
    return fallback;
  }
}

const emptyPipelineState = (): PipelineState => ({
  lastRunAt: null,
  lastError: null,
  publishedToday: 0,
  dayKey: "",
  lastHealth: [],
});

export function readState(): AppState {
  const fallback: AppState = {
    notifications: emptyPipelineState(),
    news: emptyPipelineState(),
    blogs: emptyPipelineState(),
  };
  const raw = readJson<Partial<AppState>>(dataPath("state.json"), {});
  return {
    notifications: raw.notifications ?? fallback.notifications,
    news: raw.news ?? fallback.news,
    blogs: raw.blogs ?? fallback.blogs,
  };
}

export function writeState(state: AppState): void {
  writeJson(dataPath("state.json"), state);
}

export function readPosts(pipeline: Pipeline): Post[] {
  return readJson<Post[]>(dataPath(`posts-${pipeline}.json`), []);
}

export function writePosts(pipeline: Pipeline, posts: Post[]): void {
  writeJson(dataPath(`posts-${pipeline}.json`), posts);
}

export function readSeen(): SeenEntry[] {
  return readJson<SeenEntry[]>(dataPath("seen.json"), []);
}

export function writeSeen(entries: SeenEntry[]): void {
  writeJson(dataPath("seen.json"), entries);
}

export function readCosts(): CostEntry[] {
  return readJson<CostEntry[]>(dataPath("costs.json"), []);
}

export function writeCosts(entries: CostEntry[]): void {
  writeJson(dataPath("costs.json"), entries);
}
