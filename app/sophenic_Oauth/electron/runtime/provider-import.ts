import { isCloudProvider, providerProfile, type SophenicCloudProviderId } from "./provider-registry";
import { listProviderSecretStatus, providerVaultInfo, saveProviderEntries, type ProviderCredentialEntry } from "./provider-secrets";
import { validateProviderKeys } from "./provider-validation";

export type ProviderImportSummary = {
  provider: SophenicCloudProviderId;
  name: string;
  imported: number;
  accountCount?: number;
};

export type SophenicKeyImportResult = {
  summaries: ProviderImportSummary[];
  warnings: string[];
  providers: ReturnType<typeof listProviderSecretStatus>;
  vault: ReturnType<typeof providerVaultInfo>;
};

type ParsedImport = {
  entries: Partial<Record<SophenicCloudProviderId, ProviderCredentialEntry[]>>;
  warnings: string[];
};

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.:/_-]+/gu, " ");
}

function detectHeader(line: string): SophenicCloudProviderId | null {
  const value = normalized(line);
  if (!value || /^\d+\s/.test(value)) return null;
  if (value.includes("openrouter") || value.startsWith("cle opensource")) return "openrouter";
  if (value === "grok ai" || value === "xai" || value === "x.ai" || value === "xai grok") return "xai";
  if (value === "groq" || value === "groq ai") return "groq";
  if (value === "z.ai" || value === "zai" || value.startsWith("z.ai ")) return "zai";
  if (value.includes("google gemini") || value === "gemini") return "gemini";
  if (value.includes("cloudfare") || value.includes("cloudflare")) return "cloudflare";
  if (value.includes("siliconflow")) return "siliconflow";
  if (value.includes("mistral")) return "mistral";
  if (value.includes("sambnova") || value.includes("sambanova")) return "sambanova";
  if (value.includes("cerebras")) return "cerebras";
  if (value.includes("cohere")) return "cohere";
  if (value.includes("huglins face") || value.includes("hugging face") || value.includes("huggingface")) return "huggingface";
  if (value.includes("aimlapi")) return "aimlapi";
  if (value.includes("scaleway")) return "scaleway";
  if (value.includes("nvidia")) return "nvidia";
  if (value.includes("alibaba") || value.includes("qwen model studio")) return "alibaba";
  return null;
}

function secretFromNumberedLine(line: string): string {
  const match = /^\s*\d+\s+(.+?)\s*$/.exec(line);
  return match?.[1]?.trim() || "";
}

function isProbableSecret(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 8) return false;
  if (/^https?:\/\//i.test(clean)) return false;
  if (/^(?:id|api|access key id)\s*:?$/i.test(clean)) return false;
  return !/\s{2,}/.test(clean);
}

export function parseSophenicKeyFile(text: string): ParsedImport {
  const entries: ParsedImport["entries"] = {};
  const warnings: string[] = [];
  let current: SophenicCloudProviderId | null = null;
  const cloudflareAccounts = new Map<string, { accountId?: string; key?: string }>();
  let scalewayAccessKeyId = "";

  const push = (provider: SophenicCloudProviderId, entry: ProviderCredentialEntry) => {
    if (!isCloudProvider(provider)) return;
    if (!entries[provider]) entries[provider] = [];
    entries[provider]!.push(entry);
  };

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^cle api$/i.test(normalized(line))) continue;

    const header = detectHeader(line);
    if (header) {
      current = header;
      continue;
    }
    if (!current) continue;

    if (current === "cloudflare") {
      const idMatch = /^(\d+)\s+id\s+([A-Za-z0-9_-]+)\s*$/i.exec(line);
      if (idMatch) {
        const row = cloudflareAccounts.get(idMatch[1]) || {};
        row.accountId = idMatch[2];
        cloudflareAccounts.set(idMatch[1], row);
        continue;
      }
      // Cloudflare tokens do not need a fixed textual prefix. Pair any numbered
      // secret with the numbered Account ID, then let the real Cloudflare verify
      // endpoint decide whether the token is valid.
      const tokenMatch = /^(\d+)\s+(?!id\b)(\S{12,})\s*$/i.exec(line);
      if (tokenMatch) {
        const row = cloudflareAccounts.get(tokenMatch[1]) || {};
        row.key = tokenMatch[2];
        cloudflareAccounts.set(tokenMatch[1], row);
        continue;
      }
      continue;
    }

    if (current === "scaleway") {
      if (/^access\s+key\s+id\s*:?$/i.test(line)) continue;
      if (/^api\s*:?$/i.test(line)) continue;
      if (/^SCW[A-Z0-9]+$/i.test(line)) {
        scalewayAccessKeyId = line;
        continue;
      }
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(line) || /^scw[-_A-Za-z0-9]{16,}$/i.test(line)) {
        push("scaleway", { key: line, ...(scalewayAccessKeyId ? { accessKeyId: scalewayAccessKeyId } : {}) });
        continue;
      }
    }

    const value = secretFromNumberedLine(line);
    if (value && isProbableSecret(value)) {
      if (/^gsk_/i.test(value)) push("groq", { key: value });
      else if (/^xai-/i.test(value)) push("xai", { key: value });
      else push(current, { key: value });
    }
  }

  for (const [index, row] of [...cloudflareAccounts.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (row.key && row.accountId) {
      push("cloudflare", { key: row.key, accountId: row.accountId, label: `Compte Cloudflare ${index}` });
    } else if (row.key || row.accountId) {
      warnings.push(`Cloudflare ${index}: token et Account ID doivent être présents ensemble.`);
    }
  }

  if (scalewayAccessKeyId && !(entries.scaleway?.length)) {
    warnings.push("Scaleway: Access Key ID trouvé mais Secret Key API introuvable.");
  }

  for (const [provider, providerEntries] of Object.entries(entries) as Array<[SophenicCloudProviderId, ProviderCredentialEntry[]]>) {
    const seen = new Set<string>();
    entries[provider] = providerEntries.filter((entry) => {
      const key = entry.key.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
  }

  return { entries, warnings };
}

export async function importSophenicKeyFileText(text: string): Promise<SophenicKeyImportResult> {
  const parsed = parseSophenicKeyFile(text);
  const summaries: ProviderImportSummary[] = [];
  const warnings = [...parsed.warnings];

  for (const [provider, entries] of Object.entries(parsed.entries) as Array<[SophenicCloudProviderId, ProviderCredentialEntry[]]>) {
    if (!entries.length || !isCloudProvider(provider)) continue;
    const checks = await Promise.all(entries.map(async (entry) => {
      const result = await validateProviderKeys({ provider, keys: [entry.key], accountId: entry.accountId, baseUrl: entry.baseUrl });
      return { entry, validation: result[0] };
    }));
    const accepted = checks.filter((item) => item.validation?.ok).map((item) => item.entry);
    for (const item of checks.filter((row) => !row.validation?.ok)) {
      warnings.push(`${providerProfile(provider)?.name || provider}: clé refusée pendant l’import — ${item.validation?.message || "validation impossible"}`);
    }
    if (!accepted.length) continue;
    saveProviderEntries({ provider, entries: accepted, mode: "replace" });
    const profile = providerProfile(provider);
    summaries.push({
      provider,
      name: profile?.name || provider,
      imported: accepted.length,
      ...(provider === "cloudflare" ? { accountCount: new Set(accepted.map((entry) => entry.accountId).filter(Boolean)).size } : {})
    });
  }

  return {
    summaries,
    warnings,
    providers: listProviderSecretStatus(),
    vault: providerVaultInfo()
  };
}
