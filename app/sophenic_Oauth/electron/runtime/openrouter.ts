import { getOpenRouterApiKey, getPreferredLanguage, getSophenicSystemPrompt } from "./config";

export type OpenRouterReasoningInfo = {
  supportedEfforts: string[];
  defaultEffort?: string;
  defaultEnabled?: boolean;
  mandatory?: boolean;
  supportsMaxTokens?: boolean;
};

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength?: number;
  free: boolean;
  promptPrice?: number;
  completionPrice?: number;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  reasoning?: OpenRouterReasoningInfo;
};

export type OpenRouterImageModel = {
  id: string;
  name: string;
  description?: string;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  supportsStreaming: boolean;
  free: boolean;
};

export type OpenRouterAccount = {
  isFreeTier: boolean;
  limit?: number;
  limitRemaining?: number;
  usage?: number;
};

export type OpenRouterChatMessage = { role: "user" | "assistant"; content: string };
export type OpenRouterImage = { url: string; sourceUrl: string; title: string };
export type OpenRouterUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number; costUsd?: number };
export type OpenRouterChatResult = {
  content: string;
  model: string;
  usage: OpenRouterUsage;
  contextMax?: number;
  images: OpenRouterImage[];
};
export type OpenRouterGeneratedImageResult = {
  model: string;
  images: OpenRouterImage[];
  usage: OpenRouterUsage;
};

type JsonRecord = Record<string, unknown>;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const FREE_ROUTER = "openrouter/free";
const HISTORY_CHAR_BUDGET = 34_000;
const OPENROUTER_REQUEST_TIMEOUT_MS = 75_000;
const OPENROUTER_GENERATION_TIMEOUT_MS = 180_000;
const OPENROUTER_TRANSPORT_RETRIES = 1;
const MAX_MODEL_FALLBACKS = 6;
let modelCache: { at: number; items: OpenRouterModel[] } | null = null;
let imageModelCache: { at: number; items: OpenRouterImageModel[] } | null = null;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function price(value: unknown): number | undefined {
  const n = numberValue(value);
  return n !== undefined && n >= 0 ? n : undefined;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
function isFreeModel(id: string, pricing: JsonRecord): boolean {
  if (id === FREE_ROUTER || id.endsWith(":free")) return true;
  const prompt = price(pricing.prompt);
  const completion = price(pricing.completion);
  const request = price(pricing.request);
  return prompt === 0 && completion === 0 && (request === undefined || request === 0);
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 1200) } }; }
}

export class OpenRouterRequestError extends Error {
  readonly status: number;
  readonly transient: boolean;

  constructor(message: string, status = 0, transient = false) {
    super(message);
    this.name = "OpenRouterRequestError";
    this.status = status;
    this.transient = transient;
  }
}

function apiError(status: number, payload: unknown): OpenRouterRequestError {
  const root = record(payload);
  const err = record(root.error);
  const message = stringValue(err.message) || stringValue(root.message) || `Erreur OpenRouter ${status}`;
  if (status === 401) return new OpenRouterRequestError("La clé OpenRouter est invalide ou désactivée.", status, false);
  if (status === 402) return new OpenRouterRequestError("Les crédits OpenRouter sont insuffisants pour ce modèle.", status, true);
  if (status === 408) return new OpenRouterRequestError("OpenRouter a mis trop de temps à répondre.", status, true);
  if (status === 429) return new OpenRouterRequestError("Les modèles OpenRouter disponibles sont temporairement limités. Sophenic va tenter un autre chemin automatiquement.", status, true);
  if (status === 500 || status === 502 || status === 503 || status === 504) return new OpenRouterRequestError("OpenRouter ou le fournisseur du modèle est temporairement indisponible.", status, true);
  return new OpenRouterRequestError(message, status, false);
}

export function isOpenRouterAvailabilityError(error: unknown): boolean {
  if (error instanceof OpenRouterRequestError) return error.transient;
  if (error instanceof Error && error.name === "AbortError") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket|ECONN|ENOTFOUND|ETIMEDOUT|timeout|temporarily unavailable|indisponible/i.test(message);
}

function transportError(error: unknown): OpenRouterRequestError {
  const detail = error instanceof Error ? error.message : String(error);
  return new OpenRouterRequestError(`Connexion à OpenRouter impossible (${detail || "erreur réseau"}).`, 0, true);
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const raw = response?.headers.get("retry-after")?.trim() || "";
  const seconds = raw ? Number(raw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(5_000, Math.max(300, seconds * 1_000));
  return 650 * (attempt + 1);
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchResilient(url: string, init: RequestInit, signal?: AbortSignal, retries = OPENROUTER_TRANSPORT_RETRIES, timeoutMs = OPENROUTER_REQUEST_TIMEOUT_MS): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(url, { ...init, signal: combined });
      const retryableStatus = response.status === 408 || response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504;
      if (!retryableStatus || attempt >= retries) return response;
      lastError = apiError(response.status, await parseJsonResponse(response));
      await sleepWithAbort(retryDelayMs(response, attempt), signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      lastError = error;
      if (attempt >= retries) throw transportError(error);
      await sleepWithAbort(retryDelayMs(null, attempt), signal);
    }
  }
  throw lastError instanceof Error ? lastError : transportError(lastError);
}

function authHeaders(): Record<string, string> {
  const key = getOpenRouterApiKey();
  if (!key) throw new Error("Ajoute d’abord ta clé OpenRouter dans Sophenic.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Title": "Sophenic"
  };
}

export async function getOpenRouterAccountInfo(): Promise<OpenRouterAccount> {
  const response = await fetchResilient(`${OPENROUTER_BASE}/key`, { headers: authHeaders() });
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw apiError(response.status, payload);
  const data = record(record(payload).data);
  return {
    isFreeTier: data.is_free_tier !== false,
    limit: numberValue(data.limit),
    limitRemaining: numberValue(data.limit_remaining),
    usage: numberValue(data.usage)
  };
}

export async function listOpenRouterModels(force = false): Promise<OpenRouterModel[]> {
  if (!force && modelCache && Date.now() - modelCache.at < 5 * 60_000) return modelCache.items;
  const key = getOpenRouterApiKey();
  let response: Response;
  try {
    response = await fetchResilient(`${OPENROUTER_BASE}/models`, {
      headers: key ? { Authorization: `Bearer ${key}`, "X-Title": "Sophenic" } : { "X-Title": "Sophenic" }
    });
  } catch (error) {
    if (modelCache?.items.length) return modelCache.items;
    throw error;
  }
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    if (modelCache?.items.length && isOpenRouterAvailabilityError(apiError(response.status, payload))) return modelCache.items;
    throw apiError(response.status, payload);
  }
  const data = Array.isArray(record(payload).data) ? record(payload).data as unknown[] : [];
  const items = data.map((item): OpenRouterModel | null => {
    const row = record(item);
    const id = stringValue(row.id).trim();
    if (!id) return null;
    const pricing = record(row.pricing);
    const architecture = record(row.architecture);
    const inputModalities = stringArray(architecture.input_modalities ?? architecture.inputModalities);
    const outputModalities = stringArray(architecture.output_modalities ?? architecture.outputModalities);
    const supportedParameters = stringArray(row.supported_parameters);
    const reasoningRow = record(row.reasoning);
    const supportedEfforts = stringArray(reasoningRow.supported_efforts);
    const reasoning = Object.keys(reasoningRow).length || supportedParameters.some((parameter) => /reasoning|include_reasoning/i.test(parameter))
      ? {
          supportedEfforts,
          defaultEffort: stringValue(reasoningRow.default_effort) || undefined,
          defaultEnabled: typeof reasoningRow.default_enabled === "boolean" ? reasoningRow.default_enabled : undefined,
          mandatory: typeof reasoningRow.mandatory === "boolean" ? reasoningRow.mandatory : undefined,
          supportsMaxTokens: typeof reasoningRow.supports_max_tokens === "boolean" ? reasoningRow.supports_max_tokens : undefined
        } satisfies OpenRouterReasoningInfo
      : undefined;
    // The normal chat picker only needs models capable of returning text.
    if (outputModalities.length && !outputModalities.includes("text")) return null;
    return {
      id,
      name: stringValue(row.name).trim() || id.split("/").pop() || id,
      contextLength: numberValue(row.context_length),
      free: isFreeModel(id, pricing),
      promptPrice: price(pricing.prompt),
      completionPrice: price(pricing.completion),
      inputModalities,
      outputModalities,
      supportedParameters,
      reasoning
    };
  }).filter((item): item is OpenRouterModel => Boolean(item));

  if (!items.some((item) => item.id === FREE_ROUTER)) {
    items.unshift({
      id: FREE_ROUTER,
      name: "OpenRouter Gratuit",
      contextLength: 200_000,
      free: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportedParameters: []
    });
  }
  items.sort((a, b) => Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
  modelCache = { at: Date.now(), items };
  return items;
}

export async function listOpenRouterImageModels(force = false): Promise<OpenRouterImageModel[]> {
  if (!force && imageModelCache && Date.now() - imageModelCache.at < 5 * 60_000) return imageModelCache.items;
  let response: Response;
  try {
    response = await fetchResilient(`${OPENROUTER_BASE}/images/models`, { headers: authHeaders() });
  } catch (error) {
    if (imageModelCache?.items.length) return imageModelCache.items;
    throw error;
  }
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    if (imageModelCache?.items.length && isOpenRouterAvailabilityError(apiError(response.status, payload))) return imageModelCache.items;
    throw apiError(response.status, payload);
  }
  const general = await listOpenRouterModels(force).catch(() => []);
  const generalById = new Map(general.map((item) => [item.id, item] as const));
  const data = Array.isArray(record(payload).data) ? record(payload).data as unknown[] : [];
  const items = data.map((item): OpenRouterImageModel | null => {
    const row = record(item);
    const id = stringValue(row.id).trim();
    if (!id) return null;
    const architecture = record(row.architecture);
    const supportedRaw = row.supported_parameters;
    const supportedParameters = Array.isArray(supportedRaw) ? stringArray(supportedRaw) : Object.keys(record(supportedRaw));
    const generalInfo = generalById.get(id);
    return {
      id,
      name: stringValue(row.name).trim() || id.split("/").pop() || id,
      description: stringValue(row.description).trim() || undefined,
      inputModalities: stringArray(architecture.input_modalities ?? architecture.inputModalities),
      outputModalities: stringArray(architecture.output_modalities ?? architecture.outputModalities),
      supportedParameters,
      supportsStreaming: row.supports_streaming === true,
      // There are normally no zero-cost image endpoints; if a :free model appears,
      // detect it automatically and let the UI expose it as free.
      free: generalInfo?.free === true || id.endsWith(":free")
    };
  }).filter((item): item is OpenRouterImageModel => Boolean(item));
  imageModelCache = { at: Date.now(), items };
  return items;
}

function compactHistory(messages: OpenRouterChatMessage[]): OpenRouterChatMessage[] {
  let remaining = HISTORY_CHAR_BUDGET;
  const selected: OpenRouterChatMessage[] = [];
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

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (typeof part === "string") return part;
    const row = record(part);
    return stringValue(row.text) || stringValue(row.content);
  }).filter(Boolean).join("\n");
}

function extractImageQuery(content: string, latestPrompt: string): { content: string; query: string } {
  const marker = /\s*<!--\s*SOPHENIC_IMAGE_QUERY:\s*([^>]+?)\s*-->\s*$/i;
  const found = marker.exec(content);
  const explicit = /\b(image|images|photo|photos|montre(?:-moi)?|affiche|à quoi ressemble|a quoi ressemble|picture|pictures)\b/i.test(latestPrompt);
  const query = (found?.[1] || (explicit ? latestPrompt : "")).trim().slice(0, 180);
  return { content: content.replace(marker, "").trim(), query };
}

function safePublicImageUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return null;
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) {
      const [a, b] = ipv4.slice(1).map(Number);
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null;
    }
    return url.toString();
  } catch { return null; }
}

function extractInlineImageCandidates(markdown: string): Array<{ remoteUrl: string; sourceUrl: string; title: string }> {
  const found: Array<{ remoteUrl: string; sourceUrl: string; title: string }> = [];
  const seen = new Set<string>();
  const add = (raw: string, title: string) => {
    const remoteUrl = safePublicImageUrl(raw);
    if (!remoteUrl || seen.has(remoteUrl)) return;
    seen.add(remoteUrl);
    found.push({ remoteUrl, sourceUrl: remoteUrl, title: title.trim() || "Image" });
  };

  // Markdown images generated by a model: ![alt](https://example/image.jpg).
  const markdownImage = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/gi;
  let match: RegExpExecArray | null;
  while ((match = markdownImage.exec(markdown)) && found.length < 6) add(match[2], match[1]);

  // Also support plain image URLs, while avoiding ordinary hyperlinks.
  const bareImage = /https?:\/\/[^\s<>()"']+\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>()"']*)?/gi;
  while ((match = bareImage.exec(markdown)) && found.length < 6) add(match[0], "Image");
  return found;
}

async function imageUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Sophenic/1.2 (desktop assistant)" },
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    if (!mime.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null;
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch { return null; }
}

async function loadInlineImages(markdown: string): Promise<OpenRouterImage[]> {
  const candidates = extractInlineImageCandidates(markdown);
  if (!candidates.length) return [];
  const loaded = await Promise.all(candidates.map(async (item) => {
    const dataUrl = await imageUrlToDataUrl(item.remoteUrl);
    return dataUrl ? { url: dataUrl, sourceUrl: item.sourceUrl, title: item.title } satisfies OpenRouterImage : null;
  }));
  return loaded.filter((item): item is OpenRouterImage => Boolean(item)).slice(0, 6);
}

async function searchCommonsImages(query: string): Promise<OpenRouterImage[]> {
  if (!query) return [];
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: query,
      gsrnamespace: "6",
      gsrlimit: "5",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "1200",
      origin: "*"
    });
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
      headers: { "User-Agent": "Sophenic/1.2 (desktop assistant)" },
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return [];
    const payload = record(await response.json());
    const pages = Array.isArray(record(payload.query).pages) ? record(payload.query).pages as unknown[] : [];
    const candidates = pages.map((page) => {
      const row = record(page);
      const info = Array.isArray(row.imageinfo) ? record(row.imageinfo[0]) : {};
      const mime = stringValue(info.mime);
      const remoteUrl = stringValue(info.thumburl) || stringValue(info.url);
      const sourceUrl = stringValue(info.descriptionurl) || stringValue(info.url);
      if (!remoteUrl || (mime && !mime.startsWith("image/"))) return null;
      return { remoteUrl, sourceUrl, title: stringValue(row.title).replace(/^File:/i, "") || "Wikimedia Commons" };
    }).filter((item): item is { remoteUrl: string; sourceUrl: string; title: string } => Boolean(item));

    const loaded = await Promise.all(candidates.map(async (item) => {
      const dataUrl = await imageUrlToDataUrl(item.remoteUrl);
      return dataUrl ? { url: dataUrl, sourceUrl: item.sourceUrl, title: item.title } satisfies OpenRouterImage : null;
    }));
    return loaded.filter((item): item is OpenRouterImage => Boolean(item)).slice(0, 5);
  } catch { return []; }
}

function updateUsage(target: OpenRouterUsage, raw: unknown): void {
  const usage = record(raw);
  const prompt = numberValue(usage.prompt_tokens);
  const completion = numberValue(usage.completion_tokens);
  const total = numberValue(usage.total_tokens);
  const cost = numberValue(usage.cost);
  if (prompt !== undefined) target.promptTokens = prompt;
  if (completion !== undefined) target.completionTokens = completion;
  if (total !== undefined) target.totalTokens = total;
  if (cost !== undefined) target.costUsd = cost;
}

async function chatModelCandidates(requested: string): Promise<string[]> {
  const cached = modelCache?.items || [];
  const models = await listOpenRouterModels().catch(() => cached);
  const free = models
    .filter((item) => item.free && item.id !== requested && item.id !== FREE_ROUTER)
    .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0));
  return [...new Set([requested, FREE_ROUTER, ...free.map((item) => item.id)])].slice(0, MAX_MODEL_FALLBACKS);
}

function simpleGreeting(prompt: string): boolean {
  return /^(salut|bonjour|bonsoir|hello|hey|coucou|yo|ça va|ca va|comment ça va|comment ca va)[\s?!.,]*$/i.test(prompt.trim());
}

type OpenRouterReasoningEffort = "minimal" | "low" | "medium" | "high";

function reasoningEffortForPrompt(prompt: string): OpenRouterReasoningEffort {
  if (simpleGreeting(prompt)) return "minimal";
  const complex = /\b(analy[sz]e|analyse|architecture|debug|corrige|fix|code|programme|develop|dévelop|research|recherche|compare|planifie|security|sécurité|vulnerability|vulnérabilit|audit|log|erreur)\b/i.test(prompt) || prompt.length > 700;
  return complex ? "medium" : "low";
}

function reasoningConfigForModel(model: string, prompt: string): { effort: OpenRouterReasoningEffort; exclude: true } | null {
  const info = modelCache?.items.find((item) => item.id === model);
  const declared = info?.reasoning || info?.supportedParameters.some((parameter) => /^(?:reasoning|include_reasoning)$/i.test(parameter));
  if (!declared) return null;
  const desired = reasoningEffortForPrompt(prompt);
  const supported = info?.reasoning?.supportedEfforts || [];
  if (!supported.length || supported.includes(desired)) return { effort: desired, exclude: true };
  const preference: OpenRouterReasoningEffort[] = desired === "medium"
    ? ["medium", "low", "high", "minimal"]
    : desired === "low"
      ? ["low", "minimal", "medium", "high"]
      : ["minimal", "low", "medium", "high"];
  const effort = preference.find((item) => supported.includes(item));
  return effort ? { effort, exclude: true } : null;
}

export async function chatWithOpenRouter(input: {
  model: string;
  messages: OpenRouterChatMessage[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoningConfigured?: (effort: OpenRouterReasoningEffort) => void;
}): Promise<OpenRouterChatResult> {
  const model = input.model.trim() || FREE_ROUTER;
  const history = compactHistory(input.messages);
  const latestPrompt = [...history].reverse().find((message) => message.role === "user")?.content || "";
  const systemPrompt = `${getSophenicSystemPrompt({ provider: "openrouter", model })}\n\nSophenic UI rules:\n- Never reveal chain-of-thought or hidden reasoning.\n- If a clarification is genuinely necessary, ask ONE concise question at a time and append exactly one machine-readable block at the very end: <sophenic-question>{\"index\":1,\"total\":1,\"question\":\"Question visible\",\"options\":[\"Choix A\",\"Choix B\"],\"allowOther\":true}</sophenic-question>. The UI renders it as buttons. Adjust index/total when you have a known sequence.\n- If reference images would materially help explain a real-world visual subject, append exactly one hidden marker at the very end: <!-- SOPHENIC_IMAGE_QUERY: short search query -->. Do not mention the marker.`;
  const candidates = [model];
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    let emittedText = false;
    try {
      const body: Record<string, unknown> = {
        model: candidate,
        messages: [{ role: "system", content: systemPrompt }, ...history],
        max_tokens: simpleGreeting(latestPrompt) ? 220 : 3200,
        stream: true,
        stream_options: { include_usage: true },
        provider: { allow_fallbacks: false }
      };
      const reasoning = reasoningConfigForModel(candidate, latestPrompt);
      if (reasoning) {
        body.reasoning = reasoning;
        input.onReasoningConfigured?.(reasoning.effort);
      }

      const response = await fetchResilient(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
      }, input.signal, OPENROUTER_TRANSPORT_RETRIES, OPENROUTER_GENERATION_TIMEOUT_MS);
      if (!response.ok) {
        const payload = await parseJsonResponse(response);
        throw apiError(response.status, payload);
      }
      if (!response.body) throw new OpenRouterRequestError("OpenRouter n’a renvoyé aucun flux de réponse.", 0, true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let rawContent = "";
      let resolvedModel = candidate;
      let finishReason = "";
      const usage: OpenRouterUsage = {};

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        let parsed: unknown;
        try { parsed = JSON.parse(raw); } catch { return; }
        const root = record(parsed);
        const streamError = record(root.error);
        if (Object.keys(streamError).length) {
          const code = numberValue(streamError.code) || 503;
          throw apiError(code, { error: streamError });
        }
        const streamModel = stringValue(root.model);
        if (streamModel) resolvedModel = streamModel;
        if (root.usage) updateUsage(usage, root.usage);
        const choices = Array.isArray(root.choices) ? root.choices : [];
        const first = record(choices[0]);
        const reason = stringValue(first.finish_reason);
        if (reason) finishReason = reason;
        const delta = record(first.delta);
        // Provider reasoning/reasoning_details are intentionally ignored here.
        // Sophenic renders a privacy-safe activity trace instead of raw chain-of-thought.
        const text = extractTextContent(delta.content) || stringValue(first.text);
        if (text) {
          emittedText = true;
          rawContent += text;
          input.onDelta?.(text);
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) consumeLine(line);
      }
      buffer += decoder.decode();
      for (const line of buffer.split(/\r?\n/)) consumeLine(line);

      if (!rawContent.trim()) {
        if (/length|max_tokens/i.test(finishReason)) {
          throw new OpenRouterRequestError("Le modèle a consommé sa limite de sortie sans produire de réponse utile.", 0, true);
        }
        throw new OpenRouterRequestError("Le modèle n’a renvoyé aucun texte.", 0, true);
      }
      const parsed = extractImageQuery(rawContent, latestPrompt);
      const models = await listOpenRouterModels().catch(() => []);
      const modelInfo = models.find((item) => item.id === resolvedModel) || models.find((item) => item.id === candidate);
      const [inlineImages, commonsImages] = await Promise.all([
        loadInlineImages(parsed.content),
        searchCommonsImages(parsed.query)
      ]);
      const images: OpenRouterImage[] = [];
      const seenSources = new Set<string>();
      for (const item of [...inlineImages, ...commonsImages]) {
        const key = item.sourceUrl || item.url.slice(0, 120);
        if (seenSources.has(key)) continue;
        seenSources.add(key);
        images.push(item);
        if (images.length >= 6) break;
      }
      return {
        content: parsed.content,
        model: resolvedModel,
        usage,
        contextMax: modelInfo?.contextLength,
        images
      };
    } catch (error) {
      lastError = error;
      // Never replay after any visible text was streamed: that could duplicate
      // content in the renderer. Before the first token, however, 402/429/5xx
      // and transport failures are safe to retry on another free candidate.
      if (emittedText || !isOpenRouterAvailabilityError(error) || index >= candidates.length - 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Aucun modèle OpenRouter disponible.");
}

export async function generateOpenRouterImage(input: {
  model: string;
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<OpenRouterGeneratedImageResult> {
  const model = input.model.trim();
  const prompt = input.prompt.trim();
  if (!model) throw new Error("Choisis un modèle d’image.");
  if (!prompt) throw new Error("Décris l’image à créer.");
  const preferredLanguage = getPreferredLanguage();
  const languageNames: Record<string, string> = { fr: "français", en: "English", es: "español", de: "Deutsch", it: "italiano", pt: "português" };
  const imageContext = preferredLanguage
    ? `SOPHENIC APPLICATION CONTEXT (do not render this instruction): assistant identity = Sophenic; current image engine = ${model} via OpenRouter; if the requested image contains text, write it in ${languageNames[preferredLanguage] || preferredLanguage} unless the user explicitly requests another language.`
    : `SOPHENIC APPLICATION CONTEXT (do not render this instruction): assistant identity = Sophenic; current image engine = ${model} via OpenRouter.`;
  const body: Record<string, unknown> = { model, prompt: `${imageContext}\n\n${prompt}`, n: 1 };
  if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim();
  if (input.quality) body.quality = input.quality;

  const response = await fetchResilient(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body)
  }, input.signal, OPENROUTER_TRANSPORT_RETRIES, OPENROUTER_GENERATION_TIMEOUT_MS);
  const payload = await parseJsonResponse(response);
  if (!response.ok) throw apiError(response.status, payload);
  const root = record(payload);
  const data = Array.isArray(root.data) ? root.data : [];
  const images = data.map((entry, index): OpenRouterImage | null => {
    const row = record(entry);
    const base64 = stringValue(row.b64_json).trim();
    if (!base64) return null;
    const mediaType = stringValue(row.media_type).trim() || "image/png";
    return { url: `data:${mediaType};base64,${base64}`, sourceUrl: "", title: `Image générée ${index + 1}` };
  }).filter((item): item is OpenRouterImage => Boolean(item));
  if (!images.length) throw new Error("Le modèle n’a renvoyé aucune image.");
  const usage: OpenRouterUsage = {};
  updateUsage(usage, root.usage);
  return { model, images, usage };
}
