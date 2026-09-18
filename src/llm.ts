import { config } from "./config.js";
import type { RawItem } from "./types.js";

export type ModelResult = {
  json: Record<string, unknown>;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

/**
 * THE PLACEHOLDER SEAM.
 *
 * The client's LLM provider and key are not available yet. Everything upstream and
 * downstream of this function is provider-agnostic, so when the key arrives only the
 * body of one branch below changes, plus one row in the costs.ts price table.
 *
 * `item` is passed only so the stub has source text to echo; real providers ignore it.
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
    case "anthropic":
      return anthropicModel(system, user, schema);
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${config.aiProvider}". Supported: stub, anthropic.`,
      );
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

/**
 * Real implementation, dormant until `npm i @anthropic-ai/sdk` and a key.
 * Uses structured outputs so the schema is enforced server-side rather than being
 * JSON-parsed out of prose.
 */
async function anthropicModel(
  system: string,
  user: string,
  schema: object,
): Promise<ModelResult> {
  // Non-literal specifier: the SDK is deliberately not a dependency until the client
  // picks a provider, so this must not be a compile-time import.
  const specifier = "@anthropic-ai/sdk";
  const mod = await import(specifier).catch(() => {
    throw new Error(
      "AI_PROVIDER=anthropic but @anthropic-ai/sdk is not installed. Run: npm i @anthropic-ai/sdk",
    );
  });

  const client = new mod.default({ apiKey: config.aiApiKey });
  const model = config.aiModel || "claude-opus-5";

  const message = (await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: { type: "json_schema", schema } },
  })) as {
    content: Array<{ type: string; text?: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  if (!text) throw new Error("Model returned no text block");

  return {
    json: JSON.parse(text) as Record<string, unknown>,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
    model,
  };
}
