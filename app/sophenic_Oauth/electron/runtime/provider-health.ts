import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { SophenicCloudProviderId } from "./provider-registry";

type HealthEntry = {
  provider: SophenicCloudProviderId;
  keyId: string;
  state: "ready" | "cooldown" | "invalid";
  cooldownUntil?: number;
  failures: number;
  successes: number;
  lastLatencyMs?: number;
  lastError?: string;
  updatedAt: number;
};

type HealthFile = { version: 1; entries: HealthEntry[] };

const cache = new Map<string, HealthEntry>();
let loaded = false;

function dataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}

function healthPath(): string { return path.join(dataHome(), "provider-health.json"); }
function key(provider: SophenicCloudProviderId, keyId: string): string { return `${provider}:${keyId}`; }

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(healthPath(), "utf8")) as HealthFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return;
    const now = Date.now();
    for (const entry of parsed.entries) {
      if (!entry?.provider || !entry?.keyId) continue;
      const normalized: HealthEntry = { ...entry };
      if (normalized.state !== "ready" && normalized.cooldownUntil && normalized.cooldownUntil <= now) {
        normalized.state = "ready";
        normalized.cooldownUntil = undefined;
      }
      cache.set(key(normalized.provider, normalized.keyId), normalized);
    }
  } catch { /* first run */ }
}

function persist(): void {
  try {
    const target = healthPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify({ version: 1, entries: [...cache.values()] } satisfies HealthFile, null, 2)}\n`, "utf8");
  } catch { /* health persistence is best-effort */ }
}

export function keyFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function healthFor(provider: SophenicCloudProviderId, keyId: string): HealthEntry {
  ensureLoaded();
  const id = key(provider, keyId);
  const current = cache.get(id);
  if (current) {
    if (current.state !== "ready" && current.cooldownUntil && current.cooldownUntil <= Date.now()) {
      current.state = "ready";
      current.cooldownUntil = undefined;
      current.updatedAt = Date.now();
      persist();
    }
    return current;
  }
  const fresh: HealthEntry = { provider, keyId, state: "ready", failures: 0, successes: 0, updatedAt: Date.now() };
  cache.set(id, fresh);
  return fresh;
}

export function markProviderSuccess(provider: SophenicCloudProviderId, keyId: string, latencyMs: number): void {
  const entry = healthFor(provider, keyId);
  entry.state = "ready";
  entry.cooldownUntil = undefined;
  entry.successes += 1;
  entry.lastLatencyMs = Math.max(0, Math.round(latencyMs));
  entry.lastError = undefined;
  entry.updatedAt = Date.now();
  persist();
}

export function markProviderFailure(provider: SophenicCloudProviderId, keyId: string, input: { status?: number; retryAfterMs?: number; message: string }): void {
  const entry = healthFor(provider, keyId);
  entry.failures += 1;
  entry.lastError = input.message.slice(0, 600);
  entry.updatedAt = Date.now();
  const status = input.status || 0;
  if (status === 401 || status === 403) {
    entry.state = "invalid";
    entry.cooldownUntil = Date.now() + 6 * 60 * 60_000;
  } else if (status === 402) {
    entry.state = "cooldown";
    entry.cooldownUntil = Date.now() + 24 * 60 * 60_000;
  } else if (status === 429) {
    entry.state = "cooldown";
    entry.cooldownUntil = Date.now() + Math.max(1_000, input.retryAfterMs || 60_000);
  } else if (status >= 500 || status === 408 || status === 0) {
    entry.state = "cooldown";
    entry.cooldownUntil = Date.now() + Math.max(5_000, input.retryAfterMs || 30_000);
  }
  persist();
}

export function providerHealthSummary(provider: SophenicCloudProviderId, keyIds: string[]) {
  const entries = keyIds.map((item) => healthFor(provider, item));
  const ready = entries.filter((item) => item.state === "ready").length;
  const cooldown = entries.filter((item) => item.state === "cooldown").length;
  const invalid = entries.filter((item) => item.state === "invalid").length;
  const successes = entries.reduce((sum, item) => sum + item.successes, 0);
  const failures = entries.reduce((sum, item) => sum + item.failures, 0);
  const reliability = successes + failures ? successes / (successes + failures) : 0.92;
  const latency = entries.map((item) => item.lastLatencyMs).filter((item): item is number => typeof item === "number");
  return {
    ready,
    cooldown,
    invalid,
    reliability,
    latencyMs: latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : undefined,
    nextReadyAt: entries.filter((item) => item.cooldownUntil).reduce<number | undefined>((min, item) => min === undefined ? item.cooldownUntil : Math.min(min, item.cooldownUntil || min), undefined)
  };
}
