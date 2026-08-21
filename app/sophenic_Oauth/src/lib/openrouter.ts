import { env } from "@/lib/env";

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  cost_details?: { upstream_inference_cost?: number };
}

export interface OpenRouterChunk {
  id?: string;
  model?: string;
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: OpenRouterUsage;
  error?: { message?: string; code?: string | number };
}

export function openRouterHeaders() {
  return {
    Authorization: `Bearer ${env.openRouterKey()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": env.openRouterSiteUrl(),
    "X-Title": env.openRouterAppName()
  };
}

export async function createOpenRouterChatStream(input: {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({ model: input.model, messages: input.messages, stream: true }),
    signal: input.signal
  });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${payload.slice(0, 400)}`);
  }
  if (!response.body) throw new Error("OpenRouter n'a retourné aucun flux.");
  return { response, body: response.body };
}

export async function generateOpenRouterImage(input: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
}) {
  const response = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: input.model,
      prompt: input.prompt,
      n: 1,
      aspect_ratio: input.aspectRatio ?? "1:1",
      quality: input.quality ?? "auto"
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? `OpenRouter image ${response.status}`);
  return payload as {
    data: Array<{ b64_json: string; media_type?: string }>;
    usage?: OpenRouterUsage;
  };
}
