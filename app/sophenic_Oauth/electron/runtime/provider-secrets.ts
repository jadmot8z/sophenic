import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeStorage } from "electron";
import { PROVIDER_REGISTRY, isCloudProvider, type SophenicCloudProviderId } from "./provider-registry";

export type ProviderCredentialEntry = {
  key: string;
  accountId?: string;
  baseUrl?: string;
  accessKeyId?: string;
  label?: string;
};

export type ProviderCredential = {
  entries: ProviderCredentialEntry[];
  defaultAccountId?: string;
  defaultBaseUrl?: string;
  updatedAt?: number;
};

type StoredProviderCredentialV2 = {
  entries?: ProviderCredentialEntry[];
  defaultAccountId?: string;
  defaultBaseUrl?: string;
  updatedAt?: number;
};

type LegacyProviderCredentialV1 = {
  keys?: string[];
  accountId?: string;
  baseUrl?: string;
  updatedAt?: number;
};

type SecretPayload = {
  version: 2;
  providers: Partial<Record<SophenicCloudProviderId, StoredProviderCredentialV2>>;
};

type LegacySecretPayload = {
  version: 1;
  providers: Partial<Record<SophenicCloudProviderId, LegacyProviderCredentialV1>>;
};

type SecretEnvelope = {
  version: 1 | 2;
  encryption: "electron-safeStorage" | "plaintext-dev";
  payload: string;
};

const MAX_KEYS_PER_PROVIDER = 20;

function dataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}

function secretPath(): string { return path.join(dataHome(), "provider-secrets.json"); }

function emptyPayload(): SecretPayload { return { version: 2, providers: {} }; }

function cleanOptional(value: unknown): string | undefined {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean || undefined;
}

function cleanHttpsBase(value: unknown): string | undefined {
  const clean = cleanOptional(value)?.replace(/\/+$/, "");
  return clean && /^https:\/\//i.test(clean) ? clean : undefined;
}

function cleanEntries(values: ProviderCredentialEntry[]): ProviderCredentialEntry[] {
  const unique = new Map<string, ProviderCredentialEntry>();
  for (const raw of values) {
    const key = cleanOptional(raw?.key);
    if (!key || key.length < 8) continue;
    const previous = unique.get(key) || { key };
    const next: ProviderCredentialEntry = {
      ...previous,
      key,
      ...(cleanOptional(raw.accountId) ? { accountId: cleanOptional(raw.accountId) } : {}),
      ...(cleanHttpsBase(raw.baseUrl) ? { baseUrl: cleanHttpsBase(raw.baseUrl) } : {}),
      ...(cleanOptional(raw.accessKeyId) ? { accessKeyId: cleanOptional(raw.accessKeyId) } : {}),
      ...(cleanOptional(raw.label) ? { label: cleanOptional(raw.label) } : {})
    };
    unique.set(key, next);
    if (unique.size >= MAX_KEYS_PER_PROVIDER) break;
  }
  return [...unique.values()];
}

function mergeEntries(current: ProviderCredentialEntry[], incoming: ProviderCredentialEntry[], replace = false): ProviderCredentialEntry[] {
  return cleanEntries(replace ? incoming : [...current, ...incoming]);
}

function envKeys(provider: SophenicCloudProviderId): string[] {
  const upper = provider.toUpperCase();
  const common = [
    process.env[`SOPHENIC_${upper}_API_KEYS`],
    process.env[`SOPHENIC_${upper}_API_KEY`],
    process.env[`${upper}_API_KEY`]
  ];
  if (provider === "gemini") common.push(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY);
  if (provider === "huggingface") common.push(process.env.HF_TOKEN, process.env.HUGGINGFACE_API_KEY);
  if (provider === "alibaba") common.push(process.env.DASHSCOPE_API_KEY);
  if (provider === "cloudflare") common.push(process.env.CLOUDFLARE_API_TOKEN);
  if (provider === "aimlapi") common.push(process.env.AIMLAPI_KEY);
  if (provider === "scaleway") common.push(process.env.SCW_SECRET_KEY);
  const values = common.flatMap((value) => String(value || "").split(/[\n,;]+/g)).map((value) => value.trim()).filter(Boolean);
  return [...new Set(values)].slice(0, MAX_KEYS_PER_PROVIDER);
}

function envAccountId(provider: SophenicCloudProviderId): string {
  if (provider !== "cloudflare") return "";
  return String(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.SOPHENIC_CLOUDFLARE_ACCOUNT_ID || "").trim();
}

function envBaseUrl(provider: SophenicCloudProviderId): string {
  const upper = provider.toUpperCase();
  return String(process.env[`SOPHENIC_${upper}_BASE_URL`] || "").trim();
}

function normalizePayload(raw: unknown): SecretPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyPayload();
  const root = raw as { version?: number; providers?: unknown };
  const providers: SecretPayload["providers"] = {};

  if (root.version === 2 && root.providers && typeof root.providers === "object") {
    const source = root.providers as Partial<Record<SophenicCloudProviderId, StoredProviderCredentialV2>>;
    for (const profile of PROVIDER_REGISTRY) {
      const stored = source[profile.id];
      if (!stored) continue;
      providers[profile.id] = {
        entries: cleanEntries(Array.isArray(stored.entries) ? stored.entries : []),
        ...(cleanOptional(stored.defaultAccountId) ? { defaultAccountId: cleanOptional(stored.defaultAccountId) } : {}),
        ...(cleanHttpsBase(stored.defaultBaseUrl) ? { defaultBaseUrl: cleanHttpsBase(stored.defaultBaseUrl) } : {}),
        ...(typeof stored.updatedAt === "number" ? { updatedAt: stored.updatedAt } : {})
      };
    }
    return { version: 2, providers };
  }

  if (root.version === 1 && root.providers && typeof root.providers === "object") {
    const source = root.providers as Partial<Record<SophenicCloudProviderId, LegacyProviderCredentialV1>>;
    for (const profile of PROVIDER_REGISTRY) {
      const legacy = source[profile.id];
      if (!legacy) continue;
      const defaultAccountId = cleanOptional(legacy.accountId);
      const defaultBaseUrl = cleanHttpsBase(legacy.baseUrl);
      providers[profile.id] = {
        entries: cleanEntries((legacy.keys || []).map((key) => ({
          key,
          ...(defaultAccountId ? { accountId: defaultAccountId } : {}),
          ...(defaultBaseUrl ? { baseUrl: defaultBaseUrl } : {})
        }))),
        ...(defaultAccountId ? { defaultAccountId } : {}),
        ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
        ...(typeof legacy.updatedAt === "number" ? { updatedAt: legacy.updatedAt } : {})
      };
    }
  }

  return { version: 2, providers };
}

function decodeEnvelope(envelope: SecretEnvelope): SecretPayload {
  if (!envelope.payload) return emptyPayload();
  if (envelope.encryption === "electron-safeStorage") {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Le coffre Windows de Sophenic n'est pas disponible sur cette session.");
    const clear = safeStorage.decryptString(Buffer.from(envelope.payload, "base64"));
    return normalizePayload(JSON.parse(clear));
  }
  if (envelope.encryption === "plaintext-dev" && process.env.SOPHENIC_ALLOW_PLAINTEXT_SECRETS === "1") {
    return normalizePayload(JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")));
  }
  return emptyPayload();
}

function readDiskPayload(): SecretPayload {
  try {
    const envelope = JSON.parse(fs.readFileSync(secretPath(), "utf8")) as SecretEnvelope;
    if (!envelope || ![1, 2].includes(envelope.version)) return emptyPayload();
    return decodeEnvelope(envelope);
  } catch {
    return emptyPayload();
  }
}

function writeDiskPayload(payload: SecretPayload): void {
  const target = secretPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const cleanPayload = normalizePayload(payload);
  const clear = JSON.stringify(cleanPayload);
  let envelope: SecretEnvelope;
  if (safeStorage.isEncryptionAvailable()) {
    envelope = { version: 2, encryption: "electron-safeStorage", payload: safeStorage.encryptString(clear).toString("base64") };
  } else if (process.env.SOPHENIC_ALLOW_PLAINTEXT_SECRETS === "1") {
    envelope = { version: 2, encryption: "plaintext-dev", payload: Buffer.from(clear, "utf8").toString("base64") };
  } else {
    throw new Error("Le chiffrement sécurisé Windows n'est pas disponible. Sophenic refuse d'enregistrer les clés en clair.");
  }
  fs.writeFileSync(target, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* Windows */ }
}

export function getProviderCredential(provider: SophenicCloudProviderId): ProviderCredential {
  const disk = readDiskPayload().providers[provider] || {};
  const defaultAccountId = cleanOptional(disk.defaultAccountId) || cleanOptional(envAccountId(provider));
  const defaultBaseUrl = cleanHttpsBase(disk.defaultBaseUrl) || cleanHttpsBase(envBaseUrl(provider));
  const diskEntries = cleanEntries(Array.isArray(disk.entries) ? disk.entries : []);
  const envEntries = envKeys(provider).map((key) => ({
    key,
    ...(defaultAccountId ? { accountId: defaultAccountId } : {}),
    ...(defaultBaseUrl ? { baseUrl: defaultBaseUrl } : {})
  }));
  return {
    entries: mergeEntries(diskEntries, envEntries),
    ...(defaultAccountId ? { defaultAccountId } : {}),
    ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
    updatedAt: disk.updatedAt
  };
}

function isConfigured(profile: (typeof PROVIDER_REGISTRY)[number], credential: ProviderCredential): boolean {
  if (!credential.entries.length) return false;
  if (!profile.requiresAccountId) return true;
  return credential.entries.some((entry) => Boolean(entry.accountId || credential.defaultAccountId));
}

export function listProviderSecretStatus() {
  return PROVIDER_REGISTRY.map((profile) => {
    const credential = getProviderCredential(profile.id);
    const accountCount = profile.requiresAccountId
      ? new Set(credential.entries.map((entry) => entry.accountId || credential.defaultAccountId || "").filter(Boolean)).size
      : 0;
    return {
      id: profile.id,
      name: profile.name,
      role: profile.role,
      keyCount: credential.entries.length,
      accountCount,
      configured: isConfigured(profile, credential),
      requiresAccountId: Boolean(profile.requiresAccountId),
      accountIdConfigured: Boolean(accountCount || credential.defaultAccountId),
      baseUrlConfigured: Boolean(credential.entries.some((entry) => entry.baseUrl) || credential.defaultBaseUrl),
      docsUrl: profile.docsUrl,
      keyUrl: profile.keyUrl,
      models: profile.models.map((item) => ({ id: item.id, name: item.name, context: item.context }))
    };
  });
}

export function configuredProviderIds(): SophenicCloudProviderId[] {
  return listProviderSecretStatus().filter((item) => item.configured).map((item) => item.id as SophenicCloudProviderId);
}

export function saveProviderCredential(input: {
  provider: string;
  keys?: string[];
  accountId?: string;
  baseUrl?: string;
  mode?: "replace" | "append";
}): ReturnType<typeof listProviderSecretStatus> {
  if (!isCloudProvider(input.provider)) throw new Error("Fournisseur IA inconnu.");
  const provider = input.provider;
  const profile = PROVIDER_REGISTRY.find((item) => item.id === provider)!;
  const payload = readDiskPayload();
  const current = payload.providers[provider] || {};
  const currentEntries = cleanEntries(Array.isArray(current.entries) ? current.entries : []);
  const accountId = cleanOptional(input.accountId);
  const rawBaseUrl = cleanOptional(input.baseUrl);
  if (rawBaseUrl && !/^https:\/\//i.test(rawBaseUrl)) throw new Error("L'URL personnalisée doit commencer par https://");
  const baseUrl = cleanHttpsBase(rawBaseUrl);

  const incoming = cleanEntries((input.keys || []).map((key) => ({
    key,
    ...(accountId ? { accountId } : {}),
    ...(baseUrl ? { baseUrl } : {})
  })));

  let entries = mergeEntries(currentEntries, incoming, input.mode === "replace");
  if (!incoming.length && (accountId || baseUrl)) {
    entries = entries.map((entry) => ({
      ...entry,
      ...(accountId ? { accountId } : {}),
      ...(baseUrl ? { baseUrl } : {})
    }));
  }

  const defaultAccountId = accountId || cleanOptional(current.defaultAccountId);
  const defaultBaseUrl = baseUrl || cleanHttpsBase(current.defaultBaseUrl);
  if (profile.requiresAccountId && entries.length && !entries.some((entry) => entry.accountId || defaultAccountId)) {
    throw new Error(`${profile.name} nécessite aussi un Account ID.`);
  }

  payload.providers[provider] = {
    entries,
    ...(defaultAccountId ? { defaultAccountId } : {}),
    ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
    updatedAt: Date.now()
  };
  writeDiskPayload(payload);
  return listProviderSecretStatus();
}

export function saveProviderEntries(input: {
  provider: string;
  entries: ProviderCredentialEntry[];
  mode?: "replace" | "append";
}): void {
  if (!isCloudProvider(input.provider)) throw new Error("Fournisseur IA inconnu.");
  const provider = input.provider;
  const profile = PROVIDER_REGISTRY.find((item) => item.id === provider)!;
  const payload = readDiskPayload();
  const current = payload.providers[provider] || {};
  const entries = mergeEntries(cleanEntries(Array.isArray(current.entries) ? current.entries : []), cleanEntries(input.entries), input.mode === "replace");
  if (profile.requiresAccountId && entries.length && !entries.every((entry) => Boolean(entry.accountId || current.defaultAccountId))) {
    throw new Error(`${profile.name}: chaque token importé doit être associé à son Account ID.`);
  }
  const keepDefaults = input.mode !== "replace";
  payload.providers[provider] = {
    entries,
    ...(keepDefaults && cleanOptional(current.defaultAccountId) ? { defaultAccountId: cleanOptional(current.defaultAccountId) } : {}),
    ...(keepDefaults && cleanHttpsBase(current.defaultBaseUrl) ? { defaultBaseUrl: cleanHttpsBase(current.defaultBaseUrl) } : {}),
    updatedAt: Date.now()
  };
  writeDiskPayload(payload);
}

export function clearProviderCredential(providerValue: string): ReturnType<typeof listProviderSecretStatus> {
  if (!isCloudProvider(providerValue)) throw new Error("Fournisseur IA inconnu.");
  const payload = readDiskPayload();
  delete payload.providers[providerValue];
  writeDiskPayload(payload);
  return listProviderSecretStatus();
}

export function providerVaultInfo() {
  return {
    encrypted: safeStorage.isEncryptionAvailable(),
    path: secretPath(),
    providerCount: configuredProviderIds().length,
    maxKeysPerProvider: MAX_KEYS_PER_PROVIDER
  };
}
