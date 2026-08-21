import { getProviderCredential, configuredProviderIds } from "./provider-secrets";
import { keyFingerprint, markProviderFailure, markProviderSuccess, healthFor } from "./provider-health";
import { generateOpenRouterImage, listOpenRouterImageModels, type OpenRouterGeneratedImageResult, type OpenRouterImage, type OpenRouterImageModel } from "./openrouter";
import { chooseSophenicImageModel } from "./sophenic-brain";
import { InferenceClient } from "@huggingface/inference";

export type SophenicImageEngine = OpenRouterImageModel & { provider: "xai" | "cloudflare" | "huggingface" | "gemini" | "openrouter" };
export type SophenicImageResult = OpenRouterGeneratedImageResult & { provider: "xai" | "cloudflare" | "huggingface" | "gemini" | "openrouter" };

const XAI_IMAGE_MODEL = "grok-imagine-image-quality";
const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(payload: unknown, fallback: string): string {
  const root = record(payload);
  const err = record(root.error);
  return stringValue(err.message) || stringValue(root.message) || stringValue(root.detail) || fallback;
}

function authLike(status: number, message: string): boolean {
  return status === 401 || status === 403 || /incorrect api key|invalid api key|api key.*(?:invalid|incorrect|disabled)|unauthorized|authentication|invalid token/i.test(message);
}

function readyEntries(provider: "xai" | "gemini" | "huggingface") {
  const credential = getProviderCredential(provider);
  const now = Date.now();
  return credential.entries
    .map((entry) => ({ ...entry, keyId: keyFingerprint(entry.key) }))
    .filter((entry) => {
      const health = healthFor(provider, entry.keyId);
      return health.state === "ready" || (health.cooldownUntil || 0) <= now;
    });
}

export async function listSophenicImageEngines(force = false): Promise<SophenicImageEngine[]> {
  const configured = new Set(configuredProviderIds());
  const engines: SophenicImageEngine[] = [];

  if (configured.has("xai")) {
    engines.push({
      id: XAI_IMAGE_MODEL,
      name: "Grok Imagine Image Quality",
      description: "Génération d’images xAI. Les clés invalides sont isolées automatiquement.",
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedParameters: ["n", "aspect_ratio", "resolution", "response_format"],
      supportsStreaming: false,
      free: false,
      provider: "xai"
    });
  }

  if (configured.has("cloudflare")) {
    engines.push({
      id: CLOUDFLARE_IMAGE_MODEL,
      name: "Cloudflare FLUX.1 Schnell",
      description: "Fallback image Cloudflare Workers AI avec le token et l’Account ID déjà enregistrés.",
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedParameters: ["prompt", "steps", "seed"],
      supportsStreaming: false,
      free: false,
      provider: "cloudflare"
    });
  }

  if (configured.has("huggingface")) {
    engines.push({
      id: "black-forest-labs/FLUX.1-Krea-dev",
      name: "Hugging Face Image (auto provider)",
      description: "Fallback image via Hugging Face Inference Providers avec la clé HF déjà enregistrée.",
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedParameters: ["width", "height"],
      supportsStreaming: false,
      free: false,
      provider: "huggingface"
    });
  }

  if (configured.has("gemini")) {
    engines.push({
      id: GEMINI_IMAGE_MODEL,
      name: "Gemini 3.1 Flash Image",
      description: "Fallback natif Google pour la génération d’images.",
      inputModalities: ["text"],
      outputModalities: ["image"],
      supportedParameters: ["aspect_ratio", "image_size"],
      supportsStreaming: false,
      free: false,
      provider: "gemini"
    });
  }

  if (configured.has("openrouter")) {
    try {
      const openrouter = await listOpenRouterImageModels(force);
      engines.push(...openrouter.map((item) => ({ ...item, provider: "openrouter" as const })));
    } catch {
      // An invalid OpenRouter key must never disable xAI/Gemini image generation.
    }
  }

  return engines;
}

async function generateXaiImage(input: {
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<SophenicImageResult> {
  const entries = readyEntries("xai");
  if (!entries.length) throw new Error("xAI Image : aucune clé xAI utilisable.");
  const resolution = input.quality === "high" ? "2k" : "1k";
  let lastError = "La génération xAI a échoué.";

  for (const entry of entries) {
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${entry.key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: XAI_IMAGE_MODEL,
          prompt: input.prompt,
          n: 4,
          response_format: "b64_json",
          resolution,
          ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {})
        }),
        signal: input.signal
      });
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause || lastError);
      markProviderFailure("xai", entry.keyId, { status: 0, message: lastError, retryAfterMs: 30_000 });
      continue;
    }

    const payload = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      lastError = errorMessage(payload, `xAI HTTP ${response.status}`);
      markProviderFailure("xai", entry.keyId, { status: authLike(response.status, lastError) ? 401 : response.status, message: lastError });
      // A model/request error is not fixed by trying every key. Return to the
      // global image router so Gemini/OpenRouter can take over immediately.
      if (!authLike(response.status, lastError) && response.status !== 429 && response.status < 500) break;
      continue;
    }

    const root = record(payload);
    const rows = Array.isArray(root.data) ? root.data : [];
    const images = rows.slice(0, 5).map((raw, index): OpenRouterImage | null => {
      const row = record(raw);
      const b64 = stringValue(row.b64_json).trim();
      const url = stringValue(row.url).trim();
      if (b64) return { url: `data:image/jpeg;base64,${b64}`, sourceUrl: "", title: `Grok Imagine ${index + 1}` };
      if (url) return { url, sourceUrl: url, title: `Grok Imagine ${index + 1}` };
      return null;
    }).filter((item): item is OpenRouterImage => Boolean(item));

    if (!images.length) {
      lastError = "xAI n’a renvoyé aucune image exploitable.";
      markProviderFailure("xai", entry.keyId, { status: 0, message: lastError, retryAfterMs: 15_000 });
      continue;
    }
    markProviderSuccess("xai", entry.keyId, Date.now() - started);
    return { provider: "xai", model: stringValue(root.model) || XAI_IMAGE_MODEL, images, usage: {} };
  }

  throw new Error(`xAI Image : ${lastError}`);
}

async function generateCloudflareImage(input: {
  prompt: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<SophenicImageResult> {
  const credential = getProviderCredential("cloudflare");
  const now = Date.now();
  const entries = credential.entries
    .map((entry) => ({ ...entry, accountId: entry.accountId || credential.defaultAccountId || "", keyId: keyFingerprint(entry.key) }))
    .filter((entry) => entry.accountId && ((healthFor("cloudflare", entry.keyId).cooldownUntil || 0) <= now || healthFor("cloudflare", entry.keyId).state === "ready"));
  if (!entries.length) throw new Error("Cloudflare Image : token ou Account ID indisponible.");
  let lastError = "La génération Cloudflare a échoué.";
  for (const entry of entries) {
    const images: OpenRouterImage[] = [];
    const started = Date.now();
    for (let index = 0; index < 4; index += 1) {
      try {
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(entry.accountId)}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${entry.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: input.prompt.slice(0, 2048), steps: input.quality === "high" ? 8 : 4, seed: Math.floor(Math.random() * 2_147_483_647) }),
          signal: input.signal
        });
        const payload = await response.json().catch(() => ({})) as unknown;
        if (!response.ok) {
          lastError = errorMessage(payload, `Cloudflare HTTP ${response.status}`);
          markProviderFailure("cloudflare", entry.keyId, { status: authLike(response.status, lastError) ? 401 : response.status, message: lastError });
          break;
        }
        const root = record(payload);
        const result = record(root.result);
        const b64 = stringValue(result.image || root.image).trim();
        if (!b64) { lastError = "Cloudflare n’a renvoyé aucune image exploitable."; break; }
        images.push({ url: `data:image/jpeg;base64,${b64}`, sourceUrl: "", title: `Cloudflare FLUX ${index + 1}` });
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause || lastError);
        markProviderFailure("cloudflare", entry.keyId, { status: 0, message: lastError, retryAfterMs: 20_000 });
        break;
      }
    }
    if (images.length) {
      markProviderSuccess("cloudflare", entry.keyId, Date.now() - started);
      return { provider: "cloudflare", model: CLOUDFLARE_IMAGE_MODEL, images, usage: {} };
    }
  }
  throw new Error(`Cloudflare Image : ${lastError}`);
}

async function generateHuggingFaceImage(input: {
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<SophenicImageResult> {
  const entries = readyEntries("huggingface");
  if (!entries.length) throw new Error("Hugging Face Image : aucune clé HF utilisable.");
  const models = ["black-forest-labs/FLUX.1-Krea-dev", "Qwen/Qwen-Image", "black-forest-labs/FLUX.1-dev"];
  const dimensions = (() => {
    if (input.aspectRatio === "16:9") return { width: 1344, height: 768 };
    if (input.aspectRatio === "9:16") return { width: 768, height: 1344 };
    return { width: input.quality === "high" ? 1536 : 1024, height: input.quality === "high" ? 1536 : 1024 };
  })();
  let lastError = "La génération Hugging Face a échoué.";

  for (const entry of entries) {
    for (const model of models) {
      if (input.signal?.aborted) throw input.signal.reason || new Error("Génération annulée.");
      const started = Date.now();
      try {
        const client = new InferenceClient(entry.key);
        const blob = await client.textToImage({
          provider: "auto",
          model,
          inputs: input.prompt,
          parameters: dimensions
        }, {
          outputType: "blob",
          signal: input.signal
        });
        const bytes = Buffer.from(await blob.arrayBuffer());
        if (!bytes.length) throw new Error("Réponse image vide.");
        markProviderSuccess("huggingface", entry.keyId, Date.now() - started);
        return {
          provider: "huggingface",
          model,
          images: [{ url: `data:${blob.type || "image/png"};base64,${bytes.toString("base64")}`, sourceUrl: "https://huggingface.co/", title: "Hugging Face Image" }],
          usage: {}
        };
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause || lastError);
        const status = /401|403|unauthori|invalid token|authentication/i.test(lastError) ? 401 : /429|quota|rate.?limit|credit/i.test(lastError) ? 429 : 0;
        markProviderFailure("huggingface", entry.keyId, { status, message: lastError, retryAfterMs: status === 429 ? 60_000 : 20_000 });
        if (status === 401) break;
      }
    }
  }
  throw new Error(`Hugging Face Image : ${lastError}`);
}

async function generateGeminiImage(input: {
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<SophenicImageResult> {
  const entries = readyEntries("gemini");
  if (!entries.length) throw new Error("Gemini Image : aucune clé Gemini utilisable.");
  let lastError = "La génération Gemini a échoué.";

  for (const entry of entries) {
    const started = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(GEMINI_IMAGE_MODEL)}:generateContent`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": entry.key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseModalities: ["Image"],
            ...(input.aspectRatio || input.quality === "high" ? {
              responseFormat: {
                image: {
                  ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
                  ...(input.quality === "high" ? { imageSize: "2K" } : {})
                }
              }
            } : {})
          }
        }),
        signal: input.signal
      });
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause || lastError);
      markProviderFailure("gemini", entry.keyId, { status: 0, message: lastError, retryAfterMs: 30_000 });
      continue;
    }

    const payload = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) {
      lastError = errorMessage(payload, `Gemini HTTP ${response.status}`);
      markProviderFailure("gemini", entry.keyId, { status: authLike(response.status, lastError) ? 401 : response.status, message: lastError });
      if (!authLike(response.status, lastError) && response.status !== 429 && response.status < 500) break;
      continue;
    }

    const root = record(payload);
    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const images: OpenRouterImage[] = [];
    for (const rawCandidate of candidates) {
      const candidate = record(rawCandidate);
      const content = record(candidate.content);
      const parts = Array.isArray(content.parts) ? content.parts : [];
      for (const rawPart of parts) {
        const part = record(rawPart);
        const inline = record(part.inlineData || part.inline_data);
        const data = stringValue(inline.data).trim();
        const mime = stringValue(inline.mimeType || inline.mime_type) || "image/png";
        if (data) images.push({ url: `data:${mime};base64,${data}`, sourceUrl: "", title: `Gemini Image ${images.length + 1}` });
        if (images.length >= 5) break;
      }
      if (images.length >= 5) break;
    }
    if (!images.length) {
      lastError = "Gemini n’a renvoyé aucune image exploitable.";
      markProviderFailure("gemini", entry.keyId, { status: 0, message: lastError, retryAfterMs: 15_000 });
      continue;
    }
    markProviderSuccess("gemini", entry.keyId, Date.now() - started);
    return { provider: "gemini", model: GEMINI_IMAGE_MODEL, images, usage: {} };
  }

  throw new Error(`Gemini Image : ${lastError}`);
}

export async function generateSophenicImage(input: {
  prompt: string;
  aspectRatio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<SophenicImageResult> {
  const configured = new Set(configuredProviderIds());
  const errors: string[] = [];

  for (const provider of ["xai", "cloudflare", "huggingface", "gemini", "openrouter"] as const) {
    if (!configured.has(provider)) continue;
    try {
      if (provider === "xai") return await generateXaiImage(input);
      if (provider === "cloudflare") return await generateCloudflareImage(input);
      if (provider === "huggingface") return await generateHuggingFaceImage(input);
      if (provider === "gemini") return await generateGeminiImage(input);
      const models = await listOpenRouterImageModels(false);
      const selected = chooseSophenicImageModel(models);
      if (!selected) throw new Error("OpenRouter : aucun modèle image disponible.");
      const result = await generateOpenRouterImage({
        model: selected.id,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        signal: input.signal
      });
      return { ...result, provider: "openrouter" };
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }

  throw new Error(errors.filter(Boolean).join(" · ") || "Aucun moteur d’image Sophenic n’est configuré. Ajoute xAI, Cloudflare, Hugging Face, Gemini ou OpenRouter dans Fournisseurs IA.");
}
