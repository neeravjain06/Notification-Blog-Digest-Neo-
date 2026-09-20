import { config } from "./config.js";
import type { RawItem } from "./types.js";

/** Carries the HTTP status so callers can tell a retryable failure from a config error. */
export class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LlmHttpError";
  }
}

export type ModelResult = {
  json: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/**
 * THE PLACEHOLDER SEAM.
 *
 * The client's LLM key is not available yet. Everything upstream and downstream of
 * this function is provider-agnostic, so when the key arrives only the body of one
 * branch below runs, plus one row in the costs.ts price table.
 *
 * `item` is passed only so the stub has source text to echo; the real call ignores it.
 */
export async function callModel(
  system: string,
  user: string,
  schema: object,
  item: RawItem,
): Promise<ModelResult> {
  switch (config.aiProvider) {
    case "stub":
      return stubModel(item);
    case "openai":
      return openaiModel(system, user, schema);
    default:
      throw new Error(`Unknown AI_PROVIDER "${config.aiProvider}". Supported: stub, openai.`);
  }
}

/**
 * Offline summariser. Produces structurally valid output from the source text so the
 * whole pipeline is runnable and verifiable with no key and no network.
 *
 * This is NOT a fallback - it never activates to paper over a failed real call. It is
 * an explicitly selected mode, and everything it produces is tagged engine:"stub".
 */
function stubModel(item: RawItem): ModelResult {
  const sentences = (item.bodyText ?? item.rawSubject)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lead = sentences.slice(0, 3).join(" ") || item.title;
  const ref = item.sourceRef;

  const body =
    item.pipeline === "notifications"
      ? [
          "## What changed",
          `${ref}: ${lead}`,
          "",
          "## Why it matters for shipments",
          "[STUB] No model has run. This section will describe the filing, documentation or timing impact once a provider key is configured.",
          "",
          "## What to do next",
          "- Open the official notice at the source link",
          "- Check whether your CTH, documents or policy line is touched",
          "- Ask Neo's CHA before changing Bill of Entry or Shipping Bill practice",
        ].join("\n")
      : [`[STUB] ${lead}`, "", "No model has run. This is placeholder text, not copy."].join("\n");

  return {
    json: {
      title: item.title.slice(0, 90),
      excerpt: `[STUB] ${item.title.slice(0, 160)}`,
      body,
      impact: "[STUB] Placeholder - no model has assessed this item.",
      industries: [],
    },
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "stub",
  };
}

/** A copy-pasted base URL commonly carries a trailing slash; strip it before joining. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Real implementation. Matches Neo's own scaffold env file: OpenRouter, reached
 * through the plain OpenAI-compatible /chat/completions REST endpoint. That's a plain
 * JSON POST, so this needs no SDK dependency - a fetch call does the whole job.
 */
async function openaiModel(
  system: string,
  user: string,
  schema: object,
): Promise<ModelResult> {
  if (!config.aiModel) {
    throw new Error("AI_PROVIDER=openai but no model is set (DIGEST_AI_MODEL or AI_MODEL)");
  }

  const res = await fetch(`${normalizeBaseUrl(config.aiBaseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.aiApiKey}`,
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            `${user}\n\nRespond with ONLY a single JSON object matching this schema - no ` +
            `markdown fences, no commentary before or after it:\n${JSON.stringify(schema)}`,
        },
      ],
      // json_schema strict-mode support varies across OpenRouter's underlying models;
      // json_object is honoured broadly. The schema is enforced downstream by parseDraft().
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
    // Without a timeout one hung connection stalls the whole cycle and holds the run lock.
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmHttpError(`${config.aiBaseUrl} returned HTTP ${res.status}: ${body.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Model returned no content");

  return {
    json: JSON.parse(text) as Record<string, unknown>,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    model: config.aiModel,
  };
}
