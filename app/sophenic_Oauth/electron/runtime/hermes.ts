import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HermesStatus } from "./types";
import { sophenicHermesEnvironment } from "./sophenic-agent-routing";
import { cleanHermesBaseEnvironment, ensureSophenicHermesHome } from "./sophenic-hermes-profile";

type ReadyInfo = { port: number; token: string };
export type HermesCandidate = { command: string; argsPrefix: string[]; display: string; executable: string; shell?: boolean };

function existing(file: string | undefined): string | undefined {
  return file && fs.existsSync(file) ? file : undefined;
}

function hermesCandidates(): HermesCandidate[] {
  const candidates: HermesCandidate[] = [];
  const explicit = process.env.SOPHENIC_HERMES_COMMAND?.trim();
  if (explicit) candidates.push({ command: explicit, argsPrefix: [], display: explicit, executable: explicit, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(explicit) });

  const localAppData = process.env.LOCALAPPDATA;
  const home = os.homedir();
  const windowsManaged = localAppData
    ? existing(path.join(localAppData, "hermes", "hermes-agent", "venv", "Scripts", "hermes.exe"))
    : undefined;
  if (windowsManaged) candidates.push({ command: windowsManaged, argsPrefix: [], display: windowsManaged, executable: windowsManaged });

  const windowsBinExe = localAppData ? existing(path.join(localAppData, "hermes", "bin", "hermes.exe")) : undefined;
  if (windowsBinExe) candidates.push({ command: windowsBinExe, argsPrefix: [], display: windowsBinExe, executable: windowsBinExe });
  const windowsBinCmd = localAppData ? existing(path.join(localAppData, "hermes", "bin", "hermes.cmd")) : undefined;
  if (windowsBinCmd) candidates.push({ command: windowsBinCmd, argsPrefix: [], display: windowsBinCmd, executable: windowsBinCmd, shell: true });

  const unixManaged = existing(path.join(home, ".hermes", "hermes-agent", "venv", "bin", "hermes"));
  if (unixManaged) candidates.push({ command: unixManaged, argsPrefix: [], display: unixManaged, executable: unixManaged });

  candidates.push({ command: "hermes", argsPrefix: [], display: "hermes (PATH)", executable: "hermes", shell: process.platform === "win32" });
  return candidates;
}

function probeCandidate(candidate: HermesCandidate): { ok: boolean; version?: string } {
  try {
    const result = spawnSync(candidate.command, [...candidate.argsPrefix, "--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
      shell: candidate.shell ?? false
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    return { ok: result.status === 0, version: output.split(/\r?\n/).find(Boolean) };
  } catch {
    return { ok: false };
  }
}


async function servedDashboardToken(port: number, fallbackToken: string, child: ChildProcess): Promise<string> {
  const baseUrl = `http://127.0.0.1:${port}/`;
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return fallbackToken;
    const html = await response.text();
    const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:\\.|[^"\\])*")/.exec(html);
    if (!match) return fallbackToken;
    const token = JSON.parse(match[1]) as unknown;
    if (typeof token !== "string" || !token) return fallbackToken;
    // A different served token is acceptable only while our child is alive.
    if (token !== fallbackToken && child.exitCode !== null) {
      throw new Error("Un autre service IA répond sur le port annoncé; Sophenic refuse ce jeton de session.");
    }
    return token;
  } catch (error) {
    if (child.exitCode !== null) throw error;
    return fallbackToken;
  }
}

export function resolveHermes(): { candidate?: HermesCandidate; version?: string } {
  for (const candidate of hermesCandidates()) {
    const probe = probeCandidate(candidate);
    if (probe.ok) return { candidate, version: probe.version };
  }
  return {};
}

export class HermesRuntime {
  private process: ChildProcess | null = null;
  private status: HermesStatus = { state: "stopped", connected: false, managed: false };
  private ready: ReadyInfo | null = null;
  private starting: Promise<ReadyInfo> | null = null;
  private logs: string[] = [];
  private activeProvider = "";

  inspect(): HermesStatus {
    const resolved = resolveHermes();
    if (this.process && this.process.exitCode === null && this.ready) {
      return { ...this.status, command: resolved.candidate?.display ?? this.status.command };
    }
    if (!resolved.candidate) {
      return { state: "missing", connected: false, managed: false, error: "Le moteur IA n'est pas installé ou détectable." };
    }
    return {
      state: this.status.state === "error" ? "error" : "stopped",
      command: resolved.candidate.display,
      version: resolved.version,
      connected: false,
      managed: false,
      error: this.status.error
    };
  }

  getReadyInfo(): ReadyInfo | null { return this.ready; }
  getRecentLogs(): string[] { return [...this.logs]; }
  getActiveProvider(): string { return this.activeProvider; }

  async start(provider = ""): Promise<ReadyInfo> {
    const requestedProvider = provider.trim().toLowerCase();
    if (this.ready && this.process && this.process.exitCode === null) {
      if (!requestedProvider || requestedProvider === this.activeProvider) return this.ready;
      // The managed gateway is intentionally provider-pinned. Restart when the
      // Brain changes provider so Hermes cannot reuse a stale credential scope.
      this.stop();
    }
    if (this.starting) return this.starting;

    const resolved = resolveHermes();
    if (!resolved.candidate) throw new Error("Le moteur IA est introuvable. Relance Sophenic pour terminer son installation.");

    const token = crypto.randomBytes(32).toString("hex");
    ensureSophenicHermesHome();
    const candidate = resolved.candidate;
    this.status = { state: "starting", command: candidate.display, version: resolved.version, connected: false, managed: true };

    this.starting = new Promise<ReadyInfo>((resolve, reject) => {
      const child = spawn(candidate.command, [...candidate.argsPrefix, "serve", "--host", "127.0.0.1", "--port", "0"], {
        cwd: os.homedir(),
        windowsHide: true,
        shell: candidate.shell ?? false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...cleanHermesBaseEnvironment(),
          ...sophenicHermesEnvironment(requestedProvider),
          HERMES_DESKTOP: "1",
          // Sophenic invokes Hermes only for agentic work. Use Hermes' full
          // standard interactive toolset so file/terminal/browser/clarify,
          // Computer Use and other built-in agent tools remain available.
          HERMES_TUI_TOOLSETS: process.env.HERMES_TUI_TOOLSETS || "hermes-cli",
          HERMES_DASHBOARD_SESSION_TOKEN: token
        }
      });
      this.process = child;
      this.activeProvider = requestedProvider;

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.stop();
        const message = "Le moteur IA a démarré mais n'a pas annoncé son port dans le délai prévu.";
        this.status = { state: "error", command: candidate.display, version: resolved.version, connected: false, managed: false, error: message };
        reject(new Error(message));
      }, 90_000);

      const consume = (chunk: Buffer, source: "stdout" | "stderr") => {
        const text = chunk.toString("utf8");
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          this.logs = [...this.logs, `[${source}] ${line}`].slice(-200);
          const match = line.match(/HERMES_(?:BACKEND|DASHBOARD)_READY\s+port=(\d+)/);
          if (match && !settled) {
            settled = true;
            clearTimeout(timeout);
            const port = Number(match[1]);
            void servedDashboardToken(port, token, child).then((servedToken) => {
              this.ready = { port, token: servedToken };
              this.status = {
                state: "ready",
                command: candidate.display,
                version: resolved.version,
                port,
                connected: true,
                managed: true
              };
              resolve(this.ready);
            }).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "Impossible de sécuriser la session du moteur IA";
              this.status = { state: "error", command: candidate.display, version: resolved.version, connected: false, managed: false, error: message };
              reject(error);
            });
          }
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
      child.stderr?.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.status = { state: "error", command: candidate.display, version: resolved.version, connected: false, managed: false, error: error.message };
        reject(error);
      });
      child.on("exit", (code) => {
        this.process = null;
        this.ready = null;
        this.activeProvider = "";
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const message = `Le moteur IA s'est arrêté avant d'être prêt (code ${code ?? "?"}).`;
          this.status = { state: "error", command: candidate.display, version: resolved.version, connected: false, managed: false, error: message };
          reject(new Error(message));
        } else {
          this.status = { state: "stopped", command: candidate.display, version: resolved.version, connected: false, managed: false };
        }
      });
    }).finally(() => { this.starting = null; });

    return this.starting;
  }

  stop(): void {
    const child = this.process;
    this.process = null;
    this.ready = null;
    this.activeProvider = "";
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* already stopped */ }
    }
    const resolved = resolveHermes();
    this.status = { state: resolved.candidate ? "stopped" : "missing", command: resolved.candidate?.display, version: resolved.version, connected: false, managed: false };
  }
}
