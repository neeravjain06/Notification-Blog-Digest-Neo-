import { blogTopics } from "../config.js";
import { readPosts, readSeen } from "../store.js";
import type { RawItem } from "../types.js";

/**
 * Blogs aren't scraped. The input is the oldest topic from config/blog-topics.json
 * that hasn't been written yet, plus recent notification headlines as context so the
 * post can reference what actually happened rather than being generic.
 */
export async function nextBlogTopic(contextCount = 10): Promise<RawItem[]> {
  if (!blogTopics.length) return [];

  // A topic whose draft was rejected is in seen.json but not in posts; without this the
  // same rejected topic would be picked every cycle and the queue would never advance.
  const used = new Set([
    ...readPosts("blogs").map((p) => p.sourceRef),
    ...readSeen().filter((s) => s.pipeline === "blogs").map((s) => s.sourceRef),
  ]);
  const topic = blogTopics.find((t) => !used.has(t.id));
  if (!topic) return [];

  const recent = readPosts("notifications")
    .slice(-contextCount)
    .map((p) => `- ${p.title} (${p.sourceRef}, ${p.publishedAt})`)
    .join("\n");

  const context = recent
    ? `\n\nRecent customs notifications for context (reference only what is genuinely relevant):\n${recent}`
    : "";

  return [
    {
      pipeline: "blogs",
      source: "topics",
      channel: "blog-topics",
      sourceRef: topic.id,
      title: topic.title,
      date: new Date().toISOString().slice(0, 10),
      sourceUrl: "",
      rawSubject: `Topic: ${topic.title}\nAngle: ${topic.angle}${context}`,
    },
  ];
}
