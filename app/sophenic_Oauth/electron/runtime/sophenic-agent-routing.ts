import { getProviderCredential } from "./provider-secrets";
import { healthFor, keyFingerprint, markProviderFailure, providerHealthSummary } from "./provider-health";
import { isCloudProvider, providerProfile, type SophenicCloudProviderId } from "./provider-registry";

export type AgentRuntimeProvider = "ollama" | SophenicCloudProviderId;

export function hermesProviderForSophenic(provider: string): string {
  const clean = provider.trim().toLowerCase();
  if (clean === "ollama" || clean === "openrouter") return clean;
  if (!isCloudProvider(clean)) throw new Error(`Fournisseur agent Sophenic invalide: ${provider}`);
  return `custom:sophenic_${clean}`;
}

function bestCredential(provider: SophenicCloudProviderId) {
  const credential = getProviderCredential(provider);
  const sorted = [...credential.entries].sort((a, b) => {
    const ah = healthFor(provider, keyFingerprint(a.key));
    const bh = healthFor(provider, keyFingerprint(b.key));
    const aReady = ah.state === "ready" ? 1 : 0;
    const bReady = bh.state === "ready" ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    const ar = ah.successes + ah.failures ? ah.successes / (ah.successes + ah.failures) : 0.92;
    const br = bh.successes + bh.failures ? bh.successes / (bh.successes + bh.failures) : 0.92;
    return br - ar;
  });
  // Never inject a key already known to be invalid/cooldown into a fresh Hermes
  // process. This is what made repeated 401 loops possible in older builds.
  return sorted.find((entry) => healthFor(provider, keyFingerprint(entry.key)).state === "ready");
}


export function reportHermesProviderFailure(providerValue: string, message: string): { remainingReady: number; keyCount: number } {
  const provider = providerValue.trim().toLowerCase();
  if (!isCloudProvider(provider)) return { remainingReady: 0, keyCount: 0 };
  const selected = bestCredential(provider);
  const credential = getProviderCredential(provider);
  if (selected?.key) {
    const auth = /(?:\b401\b|\b403\b|user not found|invalid api key|incorrect api key|unauthor|authentication)/i.test(message);
    const quota = /(?:\b402\b|\b429\b|quota|rate.?limit|credit)/i.test(message);
    markProviderFailure(provider, keyFingerprint(selected.key), {
      status: auth ? 401 : quota ? (/\b402\b/.test(message) ? 402 : 429) : 0,
      retryAfterMs: quota ? 60_000 : undefined,
      message: message.slice(0, 600)
    });
  }
  const ids = credential.entries.map((entry) => keyFingerprint(entry.key));
  const summary = providerHealthSummary(provider, ids);
  return { remainingReady: summary.ready, keyCount: credential.entries.length };
}
function keyEnvName(provider: SophenicCloudProviderId): string {
  return provider === "openrouter" ? "OPENROUTER_API_KEY" : `SOPHENIC_AGENT_${provider.toUpperCase()}_API_KEY`;
}

export function sophenicHermesEnvironment(providerValue?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const requested = providerValue?.trim().toLowerCase() || "";
  // A managed Code gateway sees only the credential selected by Sophenic Brain.
  // Exposing the whole vault lets Hermes auxiliary/background tasks auto-detect
  // another provider and is a known source of misleading 401 errors.
  if (requested && isCloudProvider(requested)) {
    const selected = bestCredential(requested);
    if (selected?.key) env[keyEnvName(requested)] = selected.key;
    return env;
  }
  // Non-Code/dashboard compatibility: expose verified keys only when no route
  // has been pinned. Code always calls this function with an explicit provider.
  const providers: SophenicCloudProviderId[] = [
    "xai", "groq", "zai", "gemini", "cloudflare", "siliconflow", "openrouter", "mistral", "sambanova", "cerebras", "cohere", "huggingface", "aimlapi", "nvidia", "scaleway", "alibaba"
  ];
  for (const provider of providers) {
    const selected = bestCredential(provider);
    if (!selected?.key) continue;
    env[keyEnvName(provider)] = selected.key;
  }
  return env;
}

export function hermesCustomProviderDefinition(providerValue: string): { name: string; api: string; keyEnv: string } | null {
  const provider = providerValue.trim().toLowerCase();
  if (!isCloudProvider(provider) || provider === "openrouter") return null;
  const profile = providerProfile(provider);
  if (!profile) return null;
  const credential = getProviderCredential(provider);
  const selected = bestCredential(provider);
  const accountId = selected?.accountId || credential.defaultAccountId || "";
  const baseUrl = (selected?.baseUrl || credential.defaultBaseUrl || profile.baseUrl).replace(/\/+$/, "");
  if (profile.requiresAccountId && !accountId) throw new Error(`${profile.name} nécessite un Account ID pour l’agent Code.`);
  return {
    name: `sophenic_${provider}`,
    api: baseUrl.replace("{accountId}", encodeURIComponent(accountId)),
    keyEnv: keyEnvName(provider)
  };
}
