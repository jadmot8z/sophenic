import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodeEngineProbe = {
  id: "claude-code" | "codex";
  name: string;
  installed: boolean;
  authenticated: boolean;
  functional: boolean;
  command?: string;
  version?: string;
  authLabel?: string;
  checkedAt: number;
  error?: string;
};

export type CodeEnginesStatus = {
  claudeCode: CodeEngineProbe;
  codex: CodeEngineProbe;
  checkedAt: number;
};

type LocatedCommand = { command: string; shell: boolean; version?: string };
type ProbeCache = { at: number; value: CodeEnginesStatus };

const LIVE_PROBE_TTL_MS = 5 * 60_000;
let cache: ProbeCache | null = null;

function cleanError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value || "Erreur inconnue"))
    .replace(/(?:sk-|AIza|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_\-.]{8,}/g, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

function commandCandidates(kind: "claude" | "codex"): string[] {
  const home = os.homedir();
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const names = kind === "claude" ? ["claude"] : ["codex"];
  const values: string[] = [];
  if (process.platform === "win32") {
    for (const name of names) {
      values.push(
        path.join(home, ".local", "bin", `${name}.exe`),
        path.join(appData, "npm", `${name}.cmd`),
        path.join(localAppData, "Programs", name, `${name}.exe`),
        `${name}.exe`,
        `${name}.cmd`,
        name
      );
    }
  } else {
    for (const name of names) values.push(path.join(home, ".local", "bin", name), name);
  }
  return [...new Set(values.filter(Boolean))];
}

function locate(kind: "claude" | "codex"): LocatedCommand | null {
  for (const command of commandCandidates(kind)) {
    if ((command.includes(path.sep) || /^[A-Za-z]:[\\/]/.test(command)) && !fs.existsSync(command)) continue;
    const shell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
    try {
      const result = spawnSync(command, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
        shell,
        timeout: 7_000
      });
      if (result.status === 0) {
        const version = `${result.stdout || result.stderr || ""}`.trim().split(/\r?\n/).find(Boolean)?.trim();
        return { command, shell, version };
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function runCommand(command: LocatedCommand, args: string[], timeoutMs: number, cwd = os.tmpdir()): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command.command, args, {
      cwd,
      windowsHide: true,
      shell: command.shell,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(-16_000), stderr: stderr.slice(-16_000) });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignored */ }
      finish(124);
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { stderr += `\n${cleanError(error)}`; finish(1); });
    child.once("close", (code) => finish(code ?? 1));
  });
}

async function probeClaude(forceLive: boolean): Promise<CodeEngineProbe> {
  const checkedAt = Date.now();
  const found = locate("claude");
  if (!found) return { id: "claude-code", name: "Claude Code", installed: false, authenticated: false, functional: false, checkedAt, error: "CLI Claude Code introuvable." };

  const auth = await runCommand(found, ["auth", "status"], 10_000);
  const authText = `${auth.stdout}\n${auth.stderr}`.trim();
  let authenticated = auth.code === 0 && /logged\s*in|"loggedIn"\s*:\s*true|claude\.ai|api key/i.test(authText) && !/not\s+logged\s+in|"loggedIn"\s*:\s*false/i.test(authText);
  let authLabel = authText.split(/\r?\n/).find(Boolean)?.trim();
  try {
    const parsed = JSON.parse(auth.stdout.trim()) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string | null };
    if (parsed.loggedIn === true) authenticated = true;
    if (parsed.loggedIn === false) authenticated = false;
    authLabel = [parsed.authMethod, parsed.subscriptionType].filter(Boolean).join(" · ") || authLabel;
  } catch {
    // Claude versions without JSON auth output are supported by text detection.
  }
  if (!authenticated) {
    return { id: "claude-code", name: "Claude Code", installed: true, authenticated: false, functional: false, command: found.command, version: found.version, authLabel, checkedAt, error: cleanError(authText || "Claude Code n’est pas authentifié.") };
  }

  if (!forceLive) {
    return { id: "claude-code", name: "Claude Code", installed: true, authenticated: true, functional: true, command: found.command, version: found.version, authLabel, checkedAt };
  }

  const live = await runCommand(found, [
    "-p",
    "Reply exactly SOPHENIC_OK. Do not use tools and do not modify files.",
    "--output-format",
    "text",
    "--max-turns",
    "1"
  ], 35_000);
  const liveText = `${live.stdout}\n${live.stderr}`;
  const functional = live.code === 0 && /SOPHENIC_OK/i.test(liveText) && !/401|unauthorized|not logged in|invalid authentication|user not found/i.test(liveText);
  return {
    id: "claude-code",
    name: "Claude Code",
    installed: true,
    authenticated: true,
    functional,
    command: found.command,
    version: found.version,
    authLabel,
    checkedAt,
    ...(functional ? {} : { error: cleanError(liveText || "Claude Code n’a pas répondu au test réel.") })
  };
}

async function probeCodex(forceLive: boolean): Promise<CodeEngineProbe> {
  const checkedAt = Date.now();
  const found = locate("codex");
  if (!found) return { id: "codex", name: "Codex", installed: false, authenticated: false, functional: false, checkedAt, error: "CLI Codex introuvable." };

  const auth = await runCommand(found, ["login", "status"], 10_000);
  const authText = `${auth.stdout}\n${auth.stderr}`.trim();
  const authenticated = auth.code === 0 && /logged in using/i.test(authText) && !/not logged in/i.test(authText);
  const authLabel = authText.split(/\r?\n/).find(Boolean)?.trim();
  if (!authenticated) {
    return { id: "codex", name: "Codex", installed: true, authenticated: false, functional: false, command: found.command, version: found.version, authLabel, checkedAt, error: cleanError(authText || "Codex n’est pas authentifié.") };
  }

  if (!forceLive) {
    return { id: "codex", name: "Codex", installed: true, authenticated: true, functional: true, command: found.command, version: found.version, authLabel, checkedAt };
  }

  const live = await runCommand(found, [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "Reply exactly SOPHENIC_OK. Do not modify files."
  ], 45_000);
  const liveText = `${live.stdout}\n${live.stderr}`;
  const functional = live.code === 0 && /SOPHENIC_OK/i.test(liveText) && !/401|unauthorized|not logged in|missing scopes|user not found/i.test(liveText);
  return {
    id: "codex",
    name: "Codex",
    installed: true,
    authenticated: true,
    functional,
    command: found.command,
    version: found.version,
    authLabel,
    checkedAt,
    ...(functional ? {} : { error: cleanError(liveText || "Codex n’a pas répondu au test réel.") })
  };
}

export async function inspectCodeEngines(options: { force?: boolean; live?: boolean } = {}): Promise<CodeEnginesStatus> {
  const now = Date.now();
  const live = options.live !== false;
  if (!options.force && cache && now - cache.at < LIVE_PROBE_TTL_MS) return cache.value;
  const [claudeCode, codex] = await Promise.all([probeClaude(live), probeCodex(live)]);
  const value = { claudeCode, codex, checkedAt: Date.now() };
  cache = { at: Date.now(), value };
  return value;
}

export function clearCodeEngineProbeCache(): void { cache = null; }
