import { getSophenicSystemPrompt } from "./config";
import { getProviderCredential } from "./provider-secrets";
import { healthFor, keyFingerprint, markProviderFailure, markProviderSuccess, providerHealthSummary } from "./provider-health";
import { providerProfile, type ProviderProfile, type SophenicCloudProviderId } from "./provider-registry";
import type { OpenRouterChatMessage, OpenRouterChatResult, OpenRouterUsage } from "./openrouter";

export type ProviderFailureKind = "auth" | "model" | "quota" | "network" | "request" | "unknown";

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly provider: SophenicCloudProviderId,
    public readonly status = 0,
    public readonly retryAfterMs?: number,
    public readonly availability = true,
    public readonly kind: ProviderFailureKind = "unknown"
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

function classifyProviderFailure(status: number, message: string): ProviderFailureKind {
  const text = message.toLowerCase();
  if (status === 401 || status === 403 || /incorrect api key|invalid api key|api key.*(?:invalid|incorrect|disabled)|unauthorized|authentication|auth token|invalid token/.test(text)) return "auth";
  if (status === 402 || status === 429 || /quota|rate.?limit|too many requests|insufficient (?:credit|balance)|credits? exhausted/.test(text)) return "quota";
  if (/model.*(?:not found|unknown|invalid|unavailable)|does not exist|unsupported model|model listing|unknown model/.test(text)) return "model";
  if (status === 0 || status === 408 || status >= 500 || /timeout|timed out|network|fetch failed|connection refused|econn/.test(text)) return "network";
  if (status >= 400) return "request";
  return "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    if (typeof item === "string") return item;
    const row = record(item);
    return stringValue(row.text) || stringValue(row.content) || stringValue(record(row.text).value);
  }).filter(Boolean).join("");
}

function parseUsage(value: unknown): OpenRouterUsage {
  const row = record(value);
  const promptTokens = numberValue(row.prompt_tokens) ?? numberValue(row.input_tokens) ?? numberValue(row.promptTokens);
  const completionTokens = numberValue(row.completion_tokens) ?? numberValue(row.output_tokens) ?? numberValue(row.completionTokens);
  const totalTokens = numberValue(row.total_tokens) ?? numberValue(row.totalTokens) ?? ((promptTokens || completionTokens) ? (promptTokens || 0) + (completionTokens || 0) : undefined);
  return { promptTokens, completionTokens, totalTokens };
}

function mergeUsage(target: OpenRouterUsage, value: unknown): void {
  const next = parseUsage(value);
  if (next.promptTokens !== undefined) target.promptTokens = next.promptTokens;
  if (next.completionTokens !== undefined) target.completionTokens = next.completionTokens;
  if (next.totalTokens !== undefined) target.totalTokens = next.totalTokens;
}

function parseDurationMs(value: string): number | undefined {
  const clean = value.trim().toLowerCase();
  if (!clean) return undefined;
  const numeric = Number(clean);
  if (Number.isFinite(numeric)) return numeric > 10_000 ? Math.max(0, numeric - Date.now()) : numeric * 1_000;
  const match = /([\d.]+)\s*(ms|s|sec|secs|second|seconds|m|min|minute|minutes|h|hour|hours)/.exec(clean);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) return undefined;
    if (unit === "ms") return amount;
    if (unit.startsWith("s")) return amount * 1_000;
    if (unit === "m" || unit.startsWith("min")) return amount * 60_000;
    if (unit === "h" || unit.startsWith("hour")) return amount * 3_600_000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function retryAfterMs(headers: Headers): number | undefined {
  const candidates = [
    headers.get("retry-after"),
    headers.get("x-ratelimit-reset"),
    headers.get("x-ratelimit-reset-requests"),
    headers.get("x-ratelimit-reset-tokens"),
    headers.get("ratelimit-reset")
  ].filter((item): item is string => Boolean(item));
  const values = candidates.map(parseDurationMs).filter((item): item is number => typeof item === "number");
  return values.length ? Math.max(1_000, Math.min(...values)) : undefined;
}

async function parseErrorPayload(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as unknown;
    const root = record(payload);
    const error = record(root.error);
    return stringValue(error.message) || stringValue(root.message) || stringValue(root.detail) || text.slice(0, 800);
  } catch {
    return text.slice(0, 800);
  }
}

function resolvedBaseUrl(
  profile: ProviderProfile,
  provider: SophenicCloudProviderId,
  route: { accountId?: string; baseUrl?: string }
): string {
  const credential = getProviderCredential(provider);
  const raw = route.baseUrl || credential.defaultBaseUrl || profile.baseUrl;
  if (profile.requiresAccountId) {
    const accountId = (route.accountId || credential.defaultAccountId || "").trim();
    if (!accountId) throw new ProviderRequestError(`${profile.name} nécessite aussi l'Account ID associé à cette clé.`, provider, 0, undefined, true);
    return raw.replace("{accountId}", encodeURIComponent(accountId)).replace(/\/+$/, "");
  }
  return raw.replace(/\/+$/, "");
}

function availableKeys(provider: SophenicCloudProviderId): Array<{ value: string; keyId: string; accountId?: string; baseUrl?: string }> {
  const credential = getProviderCredential(provider);
  return credential.entries.map((entry) => ({
    value: entry.key,
    keyId: keyFingerprint(entry.key),
    ...(entry.accountId ? { accountId: entry.accountId } : {}),
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {})
  })).sort((a, b) => {
    const ah = healthFor(provider, a.keyId);
    const bh = healthFor(provider, b.keyId);
    const aReady = ah.state === "ready" ? 1 : 0;
    const bReady = bh.state === "ready" ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    const aReliability = ah.successes + ah.failures ? ah.successes / (ah.successes + ah.failures) : 0.92;
    const bReliability = bh.successes + bh.failures ? bh.successes / (bh.successes + bh.failures) : 0.92;
    return bReliability - aReliability;
  });
}

function reasoningSupported(provider: SophenicCloudProviderId, model: string): boolean {
  if (provider === "gemini") return /^gemini-/i.test(model);
  if (provider === "xai") return /^grok-/i.test(model);
  if (provider === "groq" || provider === "cerebras" || provider === "sambanova") return /gpt-oss/i.test(model);
  return false;
}

function requestBody(input: {
  provider: SophenicCloudProviderId;
  model: string;
  messages: OpenRouterChatMessage[];
  stream: boolean;
  maxTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Record<string, unknown> {
  const systemPrompt = getSophenicSystemPrompt({ provider: input.provider, model: input.model });
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [{ role: "system", content: systemPrompt }, ...input.messages],
    max_tokens: input.maxTokens || 3200,
    stream: input.stream
  };
  if (input.reasoningEffort && reasoningSupported(input.provider, input.model)) {
    body.reasoning_effort = input.provider === "xai" && input.reasoningEffort === "minimal" ? "low" : input.reasoningEffort;
  }
  return body;
}

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timeout fournisseur IA")), timeoutMs);
  const abort = () => controller.abort(signal?.reason || new Error("Requête annulée"));
  signal?.addEventListener("abort", abort, { once: true });
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function runWithKey(input: {
  provider: SophenicCloudProviderId;
  model: string;
  messages: OpenRouterChatMessage[];
  stream: boolean;
  apiKey: string;
  keyId: string;
  accountId?: string;
  baseUrl?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  maxTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Promise<OpenRouterChatResult> {
  const profile = providerProfile(input.provider);
  if (!profile) throw new ProviderRequestError("Fournisseur IA inconnu.", input.provider);
  const url = `${resolvedBaseUrl(profile, input.provider, { accountId: input.accountId, baseUrl: input.baseUrl })}/chat/completions`;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        ...profile.defaultHeaders
      },
      body: JSON.stringify(requestBody(input))
    }, input.signal, input.stream ? 180_000 : 120_000);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause || "Erreur réseau");
    markProviderFailure(input.provider, input.keyId, { message });
    throw new ProviderRequestError(`${profile.name}: ${message}`, input.provider, 0, 30_000, true, "network");
  }

  if (!response.ok) {
    const message = await parseErrorPayload(response);
    const retry = retryAfterMs(response.headers);
    const kind = classifyProviderFailure(response.status, message);
    // Some providers return HTTP 400 for an invalid/disabled key. Treat that as
    // an authentication failure so this specific key is quarantined and the
    // next key/provider can be tried automatically. Model/request failures do
    // not poison the key: Brain will simply try another model/provider.
    const healthStatus = kind === "auth" ? 401 : response.status;
    markProviderFailure(input.provider, input.keyId, { status: healthStatus, retryAfterMs: retry, message });
    throw new ProviderRequestError(`${profile.name}: ${message}`, input.provider, response.status, retry, true, kind);
  }

  const usage: OpenRouterUsage = {};
  let content = "";
  let resolvedModel = input.model;

  if (!input.stream) {
    const payload = await response.json().catch(() => null) as unknown;
    const root = record(payload);
    const first = record(Array.isArray(root.choices) ? root.choices[0] : undefined);
    const message = record(first.message);
    content = extractText(message.content) || extractText(first.text) || extractText(root.output_text);
    resolvedModel = stringValue(root.model) || input.model;
    mergeUsage(usage, root.usage);
  } else if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === "[DONE]") return;
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return; }
      const root = record(payload);
      const err = record(root.error);
      if (Object.keys(err).length) {
        const message = stringValue(err.message) || "Erreur de streaming fournisseur.";
        const status = numberValue(err.code) || numberValue(err.status) || 500;
        const kind = classifyProviderFailure(status, message);
        const healthStatus = kind === "auth" ? 401 : status;
        markProviderFailure(input.provider, input.keyId, { status: healthStatus, message });
        throw new ProviderRequestError(`${profile.name}: ${message}`, input.provider, status, undefined, true, kind);
      }
      const streamModel = stringValue(root.model);
      if (streamModel) resolvedModel = streamModel;
      if (root.usage) mergeUsage(usage, root.usage);
      const first = record(Array.isArray(root.choices) ? root.choices[0] : undefined);
      const delta = record(first.delta);
      const text = extractText(delta.content) || extractText(first.text);
      if (text) {
        content += text;
        input.onDelta?.(text);
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) consume(line);
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) consume(line);
  } else {
    throw new ProviderRequestError(`${profile.name}: flux de réponse absent.`, input.provider, 0, undefined, true);
  }

  if (!content.trim()) {
    markProviderFailure(input.provider, input.keyId, { message: "Réponse vide" });
    throw new ProviderRequestError(`${profile.name}: le modèle n'a renvoyé aucun texte exploitable.`, input.provider, 0, 15_000, true, "model");
  }

  markProviderSuccess(input.provider, input.keyId, Date.now() - started);
  const modelInfo = profile.models.find((item) => item.id === resolvedModel) || profile.models.find((item) => item.id === input.model);
  return { content, model: resolvedModel, usage, contextMax: modelInfo?.context, images: [] };
}

export async function chatWithCloudProvider(input: {
  provider: SophenicCloudProviderId;
  model: string;
  messages: OpenRouterChatMessage[];
  stream?: boolean;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  maxTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}): Promise<OpenRouterChatResult & { keyId: string }> {
  const profile = providerProfile(input.provider);
  if (!profile) throw new ProviderRequestError("Fournisseur IA inconnu.", input.provider);
  const keys = availableKeys(input.provider);
  if (!keys.length) throw new ProviderRequestError(`Aucune clé ${profile.name} n'est configurée.`, input.provider, 0, undefined, true);

  let lastError: unknown = null;
  let eligible = keys.filter((item) => healthFor(input.provider, item.keyId).state === "ready");
  if (!eligible.length) {
    const now = Date.now();
    eligible = keys.filter((item) => (healthFor(input.provider, item.keyId).cooldownUntil || 0) <= now);
  }
  if (!eligible.length) {
    const summary = providerHealthSummary(input.provider, keys.map((item) => item.keyId));
    const wait = summary.nextReadyAt ? Math.max(1, Math.ceil((summary.nextReadyAt - Date.now()) / 1000)) : undefined;
    throw new ProviderRequestError(`${profile.name}: toutes les clés sont temporairement en cooldown${wait ? ` (${wait}s)` : ""}.`, input.provider, 429, wait ? wait * 1000 : undefined, true);
  }

  for (const entry of eligible) {
    let emitted = false;
    try {
      const result = await runWithKey({
        ...input,
        stream: input.stream !== false,
        apiKey: entry.value,
        keyId: entry.keyId,
        accountId: entry.accountId,
        baseUrl: entry.baseUrl,
        onDelta: (text) => {
          emitted = emitted || Boolean(text);
          input.onDelta?.(text);
        }
      });
      return { ...result, keyId: entry.keyId };
    } catch (cause) {
      lastError = cause;
      if (input.signal?.aborted || emitted) throw cause;
      // Auth/quota/network failures can be key-specific, so rotate keys. A bad
      // model or malformed request will fail on every key; return to Brain so
      // it can move to a different model/provider without wasting time.
      if (cause instanceof ProviderRequestError && (cause.kind === "model" || cause.kind === "request")) throw cause;
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderRequestError(`${profile.name}: aucune clé disponible.`, input.provider, 503, undefined, true);
}


export async function requestCloudProviderChatCompletion(input: {
  provider: SophenicCloudProviderId;
  model: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ payload: unknown; keyId: string }> {
  const profile = providerProfile(input.provider);
  if (!profile) throw new ProviderRequestError("Fournisseur IA inconnu.", input.provider);
  const keys = availableKeys(input.provider);
  if (!keys.length) throw new ProviderRequestError(`Aucune clé ${profile.name} n'est configurée.`, input.provider, 0, undefined, true);

  let eligible = keys.filter((item) => healthFor(input.provider, item.keyId).state === "ready");
  if (!eligible.length) {
    const now = Date.now();
    eligible = keys.filter((item) => (healthFor(input.provider, item.keyId).cooldownUntil || 0) <= now);
  }
  if (!eligible.length) throw new ProviderRequestError(`${profile.name}: toutes les clés sont temporairement indisponibles.`, input.provider, 429, 30_000, true);

  let lastError: unknown = null;
  for (const entry of eligible) {
    const url = `${resolvedBaseUrl(profile, input.provider, { accountId: entry.accountId, baseUrl: entry.baseUrl })}/chat/completions`;
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${entry.value}`,
          "Content-Type": "application/json",
          ...profile.defaultHeaders
        },
        body: JSON.stringify({ ...input.body, model: input.model, stream: false })
      }, input.signal, 180_000);
      if (!response.ok) {
        const message = await parseErrorPayload(response);
        const retry = retryAfterMs(response.headers);
        const kind = classifyProviderFailure(response.status, message);
        const healthStatus = kind === "auth" ? 401 : response.status;
        markProviderFailure(input.provider, entry.keyId, { status: healthStatus, retryAfterMs: retry, message });
        const availability = kind === "auth" || kind === "quota" || kind === "network" || response.status === 409;
        const error = new ProviderRequestError(`${profile.name}: ${message}`, input.provider, response.status, retry, availability, kind);
        lastError = error;
        if (kind === "model" || kind === "request") throw error;
        continue;
      }
      const payload = await response.json().catch(() => null) as unknown;
      if (!payload) throw new ProviderRequestError(`${profile.name}: réponse JSON vide.`, input.provider, 502, undefined, true);
      markProviderSuccess(input.provider, entry.keyId, Date.now() - started);
      return { payload, keyId: entry.keyId };
    } catch (cause) {
      lastError = cause;
      if (input.signal?.aborted) throw cause;
      if (cause instanceof ProviderRequestError && !cause.availability) throw cause;
      if (!(cause instanceof ProviderRequestError)) markProviderFailure(input.provider, entry.keyId, { message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderRequestError(`${profile.name}: aucune clé disponible.`, input.provider, 503, undefined, true);
}

export function cloudProviderAvailability(provider: SophenicCloudProviderId) {
  const credential = getProviderCredential(provider);
  const keyIds = credential.entries.map((entry) => keyFingerprint(entry.key));
  const summary = providerHealthSummary(provider, keyIds);
  return { configured: credential.entries.length > 0, keyCount: credential.entries.length, ...summary };
}
