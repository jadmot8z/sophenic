import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Dedicated Hermes profile owned by SOPHENIC.
 *
 * We intentionally do not reuse the user's default ~/.hermes profile for
 * SOPHENIC Code. Hermes stores provider credentials, auth pools, sessions and
 * fallback configuration in HERMES_HOME. Reusing that profile can make a
 * perfectly valid SOPHENIC route inherit an unrelated/stale credential and
 * surface misleading errors such as `HTTP 401: User not found`.
 *
 * Tool subprocesses still keep the real OS HOME (Hermes' default
 * terminal.home_mode=auto), so Git/SSH/npm/Claude Code/Codex credentials remain
 * visible to tools without sharing Hermes' own provider/session state.
 */
export function sophenicHermesHome(): string {
  const explicit = process.env.SOPHENIC_HERMES_HOME?.trim();
  if (explicit) return path.resolve(explicit);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Sophenic", "hermes-code");
  }
  return path.join(os.homedir(), ".sophenic", "hermes-code");
}

export function ensureSophenicHermesHome(): string {
  const home = sophenicHermesHome();
  fs.mkdirSync(home, { recursive: true });
  return home;
}

const PROVIDER_ENV_NAMES = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "COHERE_API_KEY",
  "NVIDIA_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "SCALEWAY_API_KEY"
] as const;

/**
 * Build a clean process environment for the managed Hermes gateway.
 * Provider secrets are supplied separately by sophenicHermesEnvironment().
 * Removing inherited provider variables prevents Hermes auxiliary/background
 * tasks from auto-detecting a provider that Sophenic Brain did not select.
 */
export function cleanHermesBaseEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of PROVIDER_ENV_NAMES) delete env[key];
  for (const key of Object.keys(env)) {
    if (/^SOPHENIC_AGENT_[A-Z0-9_]+_API_KEY$/.test(key)) delete env[key];
  }
  env.HERMES_HOME = ensureSophenicHermesHome();
  env.HERMES_PROFILE = "sophenic-code";
  return env;
}
