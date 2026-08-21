import http from "node:http";
import { getSophenicSystemPrompt } from "./config";
import type { OllamaModel, OllamaStatus } from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const LOCAL_CHAT_HISTORY_CHAR_BUDGET = 34_000;
const LOCAL_CHAT_TIMEOUT_MS = 180_000;

type LocalChatMessage = { role: "user" | "assistant"; content: string };
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numberValue(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function requestJson<T>(url: URL, timeoutMs = 1800): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Ollama HTTP ${res.statusCode ?? "unknown"}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Ollama timeout")));
    req.on("error", reject);
  });
}

export async function inspectOllama(baseUrl = process.env.SOPHENIC_OLLAMA_URL || DEFAULT_BASE_URL): Promise<OllamaStatus> {
  const normalized = baseUrl.replace(/\/$/, "");
  try {
    const [tags, version] = await Promise.all([
      requestJson<{ models?: Array<{
        name?: string;
        model?: string;
        modified_at?: string;
        size?: number;
        digest?: string;
        details?: {
          format?: string;
          family?: string;
          families?: string[];
          parameter_size?: string;
          quantization_level?: string;
        };
      }> }>(new URL(`${normalized}/api/tags`)),
      requestJson<{ version?: string }>(new URL(`${normalized}/api/version`)).catch(() => ({ version: undefined }))
    ]);

    const models: OllamaModel[] = (tags.models ?? []).map((item) => ({
      name: item.name || item.model || "unknown",
      model: item.model || item.name || "unknown",
      modifiedAt: item.modified_at,
      size: Number(item.size ?? 0),
      digest: item.digest,
      details: {
        format: item.details?.format,
        family: item.details?.family,
        families: item.details?.families,
        parameterSize: item.details?.parameter_size,
        quantizationLevel: item.details?.quantization_level
      }
    }));

    return { state: "ready", baseUrl: normalized, version: version.version, models };
  } catch (error) {
    return {
      state: "missing",
      baseUrl: normalized,
      models: [],
      error: error instanceof Error ? error.message : "Ollama unavailable"
    };
  }
}

function compactLocalHistory(messages: LocalChatMessage[]): LocalChatMessage[] {
  let remaining = LOCAL_CHAT_HISTORY_CHAR_BUDGET;
  const selected: LocalChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const content = message.content.trim();
    if (!content) continue;
    const take = Math.min(content.length, remaining);
    if (take <= 0) break;
    selected.push({ role: message.role, content: content.slice(content.length - take) });
    remaining -= take;
  }
  return selected.reverse();
}

function localModelCandidates(models: OllamaModel[]): OllamaModel[] {
  // Do not accidentally select an embedding/reranking/audio model just because
  // it is the smallest item installed in Ollama. Prefer lightweight chat or
  // instruct models, then fall back to other plausible text-generation models.
  const nonChat = /(?:^|[-_.:/])(embed|embedding|rerank|reranker|bge|clip|whisper|minilm)(?:$|[-_.:/])/i;
  const chatHint = /(instruct|chat|qwen|llama|mistral|gemma|phi|deepseek|smollm|granite|command-r)/i;
  return [...models]
    .filter((model) => !nonChat.test(model.model) && !nonChat.test(model.name))
    .sort((a, b) => {
      const aHint = chatHint.test(`${a.model} ${a.name}`) ? 0 : 1;
      const bHint = chatHint.test(`${b.model} ${b.name}`) ? 0 : 1;
      if (aHint !== bHint) return aHint - bHint;
      const aSize = a.size > 0 ? a.size : Number.MAX_SAFE_INTEGER;
      const bSize = b.size > 0 ? b.size : Number.MAX_SAFE_INTEGER;
      return aSize - bSize || a.model.localeCompare(b.model);
    });
}


export function ollamaThinkingSetting(model: string): boolean | "low" | "medium" | "high" {
  const id = model.toLowerCase();
  if (/gpt[-_.:]?oss/.test(id)) return "medium";
  if (/qwen3|deepseek[-_.:]?(?:r1|v3\.?1)/.test(id)) return true;
  return false;
}

export type OllamaChatFallbackResult = {
  content: string;
  model: string;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd: 0 };
};


export async function chatWithLocalOllamaModel(input: {
  model: string;
  messages: LocalChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<OllamaChatFallbackResult> {
  const status = await inspectOllama();
  if (status.state !== "ready" || !status.models.length) throw new Error("Aucun modèle Ollama local n’est installé et prêt.");
  const requested = input.model.trim().replace(/^ollama\//i, "");
  const selected = status.models.find((item) => item.model === requested || item.name === requested);
  if (!selected) throw new Error(`Le modèle Ollama ${requested || "demandé"} n’est pas installé.`);

  const timeout = AbortSignal.timeout(LOCAL_CHAT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const response = await fetch(`${status.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: selected.model,
      messages: [
        { role: "system", content: `${getSophenicSystemPrompt({ provider: "ollama", model: selected.model })}\n\nRéponds directement. N’expose jamais de raisonnement interne ou de chaîne de pensée.` },
        ...compactLocalHistory(input.messages)
      ],
      // Let supported local reasoning models think, but never copy message.thinking
      // into the visible transcript. The renderer shows only a safe activity trace.
      think: ollamaThinkingSetting(selected.model),
      options: { num_predict: 3200 },
      stream: false
    }),
    signal
  });

  const text = await response.text();
  let payload: unknown = {};
  try { payload = text.trim() ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  const root = record(payload);
  if (!response.ok) {
    const detail = typeof root.error === "string" ? root.error : `Ollama HTTP ${response.status}`;
    throw new Error(detail);
  }
  const message = record(root.message);
  const content = typeof message.content === "string" ? message.content.trim() : "";
  if (!content) throw new Error(`Le modèle Ollama ${selected.model} n’a renvoyé aucun texte.`);
  input.onDelta?.(content);
  const promptTokens = numberValue(root.prompt_eval_count);
  const completionTokens = numberValue(root.eval_count);
  return {
    content,
    model: `ollama/${selected.model}`,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens !== undefined || completionTokens !== undefined ? (promptTokens || 0) + (completionTokens || 0) : undefined,
      costUsd: 0
    }
  };
}

export async function chatWithLocalOllama(input: {
  messages: LocalChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<OllamaChatFallbackResult> {
  const status = await inspectOllama();
  if (status.state !== "ready" || !status.models.length) {
    throw new Error("Aucun modèle Ollama local n’est installé et prêt.");
  }
  const candidates = localModelCandidates(status.models).slice(0, 3);
  if (!candidates.length) throw new Error("Aucun modèle Ollama local de conversation utilisable n’a été trouvé.");

  const timeout = AbortSignal.timeout(LOCAL_CHAT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let lastError: unknown = null;

  for (const selected of candidates) {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
    try {
      const response = await fetch(`${status.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selected.model,
          messages: [
            { role: "system", content: `${getSophenicSystemPrompt({ provider: "ollama", model: selected.model })}\n\nRéponds directement. N’expose jamais de raisonnement interne ou de chaîne de pensée.` },
            ...compactLocalHistory(input.messages)
          ],
          // Supported thinking models may reason locally; raw message.thinking stays private.
          think: ollamaThinkingSetting(selected.model),
          options: { num_predict: 2048 },
          stream: false
        }),
        signal
      });

      const text = await response.text();
      let payload: unknown = {};
      try { payload = text.trim() ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
      const root = record(payload);
      if (!response.ok) {
        const detail = typeof root.error === "string" ? root.error : `Ollama HTTP ${response.status}`;
        throw new Error(detail);
      }
      const message = record(root.message);
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) throw new Error(`Le modèle Ollama ${selected.model} n’a renvoyé aucun texte.`);

      input.onDelta?.(content);
      const promptTokens = numberValue(root.prompt_eval_count);
      const completionTokens = numberValue(root.eval_count);
      return {
        content,
        model: `ollama/${selected.model}`,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens !== undefined || completionTokens !== undefined ? (promptTokens || 0) + (completionTokens || 0) : undefined,
          costUsd: 0
        }
      };
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Aucun modèle Ollama local n’a produit de réponse.");
}

export async function requestOllamaChatCompletion(input: {
  model: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const status = await inspectOllama();
  if (status.state !== "ready" || !status.models.length) throw new Error("Ollama n’est pas disponible.");
  const requested = input.model.trim().replace(/^ollama\//i, "");
  const selected = status.models.find((item) => item.model === requested || item.name === requested);
  if (!selected) throw new Error(`Le modèle Ollama ${requested || "demandé"} n’est pas installé.`);

  const timeout = AbortSignal.timeout(180_000);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  const body = input.body;
  const response = await fetch(`${status.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: selected.model,
      messages: Array.isArray(body.messages) ? body.messages : [],
      ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools } : {}),
      think: ollamaThinkingSetting(selected.model),
      options: { num_predict: typeof body.max_tokens === "number" ? body.max_tokens : 4096 },
      stream: false
    }),
    signal
  });
  const text = await response.text();
  let payload: unknown = {};
  try { payload = text.trim() ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  const root = record(payload);
  if (!response.ok) throw new Error(typeof root.error === "string" ? root.error : `Ollama HTTP ${response.status}`);
  const message = record(root.message);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((raw, index) => {
    const call = record(raw);
    const fn = record(call.function);
    return {
      id: typeof call.id === "string" && call.id ? call.id : `ollama_tool_${Date.now()}_${index}`,
      type: "function",
      function: {
        name: typeof fn.name === "string" ? fn.name : "",
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {})
      }
    };
  }).filter((call) => call.function.name) : [];
  const promptTokens = numberValue(root.prompt_eval_count) || 0;
  const completionTokens = numberValue(root.eval_count) || 0;
  return {
    id: `ollama-${Date.now()}`,
    object: "chat.completion",
    model: selected.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      },
      finish_reason: toolCalls.length ? "tool_calls" : "stop"
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }
  };
}
