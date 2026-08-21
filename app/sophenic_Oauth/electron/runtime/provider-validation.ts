import { providerProfile, type SophenicCloudProviderId } from "./provider-registry";

export type ProviderKeyValidation = {
  key: string;
  ok: boolean;
  status: number;
  message: string;
};

function maskProviderMessage(value: string): string {
  return value
    .replace(/(?:sk-|AIza|gsk_|hf_|xai-|nvapi-|csk-|cfut_|SCW)[A-Za-z0-9_\-.]{6,}/gi, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : {};
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const firstError = errors[0] && typeof errors[0] === "object" ? errors[0] as Record<string, unknown> : {};
    const message = typeof error.message === "string"
      ? error.message
      : typeof firstError.message === "string"
        ? firstError.message
        : typeof payload.message === "string"
          ? payload.message
          : text;
    return maskProviderMessage(message);
  } catch {
    return maskProviderMessage(text);
  }
}

function normalizedHttpsBase(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/\/+$/, "");
  if (!clean || !/^https:\/\//i.test(clean)) return undefined;
  return clean;
}

function resolveBase(provider: SophenicCloudProviderId, accountId?: string, baseUrl?: string): string {
  const profile = providerProfile(provider);
  if (!profile) throw new Error("Fournisseur IA inconnu.");

  // Scaleway users often paste the Access Key ID (SCW...) in the optional URL
  // field. It is not an endpoint. Ignore a non-URL value and use the official
  // serverless endpoint rather than turning `SCW.../models` into an invalid URL.
  const custom = normalizedHttpsBase(baseUrl);
  let resolved = (custom || profile.baseUrl).replace(/\/+$/, "");
  if (profile.requiresAccountId) {
    const account = accountId?.trim();
    if (!account) throw new Error(`${profile.name} nécessite aussi un Account ID.`);
    resolved = resolved.replace("{accountId}", encodeURIComponent(account));
  }
  return resolved;
}

async function fetchProbe(url: string, key: string, headers: Record<string, string> = {}, method: "GET" | "POST" = "GET", body?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Validation API trop lente.")), 15_000);
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      ...(body ? { body } : {}),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function isCredentialRecognized(status: number): boolean {
  // Billing/rate limits prove that the provider understood the credential.
  return status === 402 || status === 429;
}

function isAuthFailure(status: number, message: string): boolean {
  return status === 401 || status === 403 || /invalid|incorrect|unauthor|authentication|api key|token.*(?:invalid|expired|disabled)/i.test(message);
}

async function validateCloudflare(key: string, accountId?: string): Promise<ProviderKeyValidation> {
  // Cloudflare's OpenAI-compatible `/ai/v1/models` is not the credential probe.
  // The official token verification endpoint is GET /user/tokens/verify.
  const verify = await fetchProbe("https://api.cloudflare.com/client/v4/user/tokens/verify", key);
  if (!verify.ok) {
    const message = await responseMessage(verify);
    if (isCredentialRecognized(verify.status)) return { key, ok: true, status: verify.status, message: `Token Cloudflare reconnu mais temporairement limité: ${message}` };
    return { key, ok: false, status: verify.status, message: `Token Cloudflare refusé: ${message}` };
  }

  const account = accountId?.trim();
  if (!account) {
    return { key, ok: false, status: 0, message: "Token Cloudflare valide, mais l’Account ID Workers AI manque. Ajoute l’Account ID du même compte." };
  }

  // This endpoint is an official read-only Workers AI probe. It confirms both
  // the Account ID and that the token has Workers AI Read/Write permission.
  const workers = await fetchProbe(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/models/search?per_page=1`, key);
  if (workers.ok) return { key, ok: true, status: workers.status, message: "Token Cloudflare + Account ID vérifiés pour Workers AI." };
  const workersMessage = await responseMessage(workers);
  if (isCredentialRecognized(workers.status)) return { key, ok: true, status: workers.status, message: `Cloudflare Workers AI reconnu mais limité: ${workersMessage}` };
  if (workers.status === 403) {
    return { key, ok: false, status: workers.status, message: `Token Cloudflare valide, mais inutilisable pour Workers AI sur cet Account ID (permission Workers AI Read/Edit requise): ${workersMessage}` };
  }
  return { key, ok: false, status: workers.status, message: `Impossible de confirmer l’Account ID Workers AI: ${workersMessage}` };
}

async function validateScaleway(key: string, baseUrl?: string): Promise<ProviderKeyValidation> {
  const officialBase = normalizedHttpsBase(baseUrl) || "https://api.scaleway.ai/v1";
  // Scaleway Generative APIs authenticate the inference API with the Secret Key
  // as a Bearer token. The Access Key ID is not part of this URL/request.
  const response = await fetchProbe(`${officialBase.replace(/\/+$/, "")}/models`, key);
  if (response.ok) return { key, ok: true, status: response.status, message: "Clé secrète Scaleway vérifiée sur Generative APIs." };
  const message = await responseMessage(response);
  if (isCredentialRecognized(response.status)) return { key, ok: true, status: response.status, message: `Clé Scaleway reconnue mais limitée: ${message}` };
  if (isAuthFailure(response.status, message)) return { key, ok: false, status: response.status, message: `Clé Scaleway refusée: ${message}` };
  return { key, ok: false, status: response.status, message: `Impossible de confirmer la clé Scaleway (${message}).` };
}

async function validateGeneric(provider: SophenicCloudProviderId, key: string, accountId?: string, baseUrl?: string): Promise<ProviderKeyValidation> {
  const profile = providerProfile(provider);
  if (!profile) throw new Error("Fournisseur IA inconnu.");
  const base = resolveBase(provider, accountId, baseUrl);
  const response = await fetchProbe(`${base}/models`, key, profile.defaultHeaders || {});
  if (response.ok) return { key, ok: true, status: response.status, message: "Clé vérifiée par le fournisseur." };
  const message = await responseMessage(response);
  if (isCredentialRecognized(response.status)) return { key, ok: true, status: response.status, message: `Clé reconnue mais limitée: ${message}` };
  if (isAuthFailure(response.status, message)) return { key, ok: false, status: response.status, message: `Clé refusée: ${message}` };
  return { key, ok: false, status: response.status, message: `Impossible de confirmer cette clé (${message}). Elle n’a pas été enregistrée.` };
}

export async function validateProviderKeys(input: {
  provider: string;
  keys: string[];
  accountId?: string;
  baseUrl?: string;
}): Promise<ProviderKeyValidation[]> {
  const provider = input.provider.trim().toLowerCase() as SophenicCloudProviderId;
  const profile = providerProfile(provider);
  if (!profile) throw new Error("Fournisseur IA inconnu.");
  const keys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))];
  const results: ProviderKeyValidation[] = [];

  for (const key of keys) {
    try {
      if (provider === "cloudflare") results.push(await validateCloudflare(key, input.accountId));
      else if (provider === "scaleway") results.push(await validateScaleway(key, input.baseUrl));
      else results.push(await validateGeneric(provider, key, input.accountId, input.baseUrl));
    } catch (error) {
      results.push({
        key,
        ok: false,
        status: 0,
        message: `Validation impossible: ${maskProviderMessage(error instanceof Error ? error.message : String(error))}. Clé non enregistrée.`
      });
    }
  }
  return results;
}
