import { blogTopics } from "../config.js";
import { readPosts } from "../store.js";
import type { RawItem } from "../types.js";

/**
 * Blogs aren't scraped. The input is the oldest topic from config/blog-topics.json
 * that hasn't been written yet, plus recent notification headlines as context so the
 * post can reference what actually happened rather than being generic.
 */
export async function nextBlogTopic(contextCount = 10): Promise<RawItem[]> {
  if (!blogTopics.length) return [];

  const used = new Set(readPosts("blogs").map((p) => p.sourceRef));
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
