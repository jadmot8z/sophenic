import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { SophenicEffortMode } from "./sophenic-brain";
import { SophenicClaudeCodeGateway, type ClaudeGatewayRouteEvent } from "./claude-code-gateway";

export type ClaudeCodeStatus = {
  installed: boolean;
  command?: string;
  version?: string;
  gateway: ReturnType<SophenicClaudeCodeGateway["inspect"]>;
  error?: string;
};

export type ClaudeCodeRunEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "route" | "fallback"; provider: string; model: string; previousProvider?: string; previousModel?: string; reason?: string }
  | { type: "error"; message: string };

export type ClaudeCodeRunResult = {
  ok: true;
  text: string;
  sessionId?: string;
  provider: string;
  model: string;
  fallbacks: Array<{ provider: string; model: string }>;
  version?: string;
};

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Erreur inconnue"))
    .replace(/(?:sk-|AIza|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_\-.]{8,}/g, "[secret]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

function candidateCommands(): string[] {
  const home = os.homedir();
  const values = process.platform === "win32"
    ? [
        path.join(home, ".local", "bin", "claude.exe"),
        path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
        "claude.exe",
        "claude.cmd",
        "claude"
      ]
    : [path.join(home, ".local", "bin", "claude"), "claude"];
  return [...new Set(values.filter(Boolean))];
}

function inspectCommand(command: string): { command: string; version: string } | null {
  if ((command.includes(path.sep) || /^[A-Za-z]:[\\/]/.test(command)) && !fs.existsSync(command)) return null;
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 6000,
      windowsHide: true,
      shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
    });
    if (result.status === 0) {
      const version = `${result.stdout || result.stderr || "Claude Code"}`.trim().split(/\r?\n/)[0] || "Claude Code";
      return { command, version };
    }
  } catch {
    // Try next candidate.
  }
  return null;
}

function findClaudeCode(): { command: string; version: string } | null {
  for (const command of candidateCommands()) {
    const inspected = inspectCommand(command);
    if (inspected) return inspected;
  }
  return null;
}

function textFromResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
    const row = entry as Record<string, unknown>;
    return row.type === "text" && typeof row.text === "string" ? row.text : "";
  }).filter(Boolean).join("\n");
}

export class ClaudeCodeRuntime {
  private child: ChildProcess | null = null;
  private currentRequestId = "";

  constructor(private readonly gateway: SophenicClaudeCodeGateway) {}

  inspect(): ClaudeCodeStatus {
    const found = findClaudeCode();
    return found
      ? { installed: true, command: found.command, version: found.version, gateway: this.gateway.inspect() }
      : {
          installed: false,
          gateway: this.gateway.inspect(),
          error: "Claude Code n’est pas installé. Sophenic conservera Hermes comme moteur de secours."
        };
  }

  abort(requestId?: string): boolean {
    if (!this.child) return false;
    if (requestId && this.currentRequestId && requestId !== this.currentRequestId) return false;
    try { this.child.kill(); } catch { /* ignored */ }
    this.child = null;
    this.currentRequestId = "";
    this.gateway.clearTask();
    return true;
  }

  async runTask(input: {
    requestId: string;
    cwd: string;
    prompt: string;
    effortMode?: SophenicEffortMode;
    onEvent?: (event: ClaudeCodeRunEvent) => void;
  }): Promise<ClaudeCodeRunResult> {
    if (this.child) throw new Error("Une tâche Sophenic Code est déjà en cours.");
    const requestId = input.requestId.trim();
    const prompt = input.prompt.trim();
    const cwd = path.resolve(input.cwd.trim());
    if (!requestId || !prompt) throw new Error("Tâche Sophenic Code invalide.");
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) throw new Error("Le workspace Sophenic Code n’est pas un dossier.");

    const found = findClaudeCode();
    if (!found) throw new Error("Claude Code n’est pas installé ou n’est pas accessible dans PATH.");

    await this.gateway.start();
    const brainPlan = await this.gateway.prepareTask(prompt, input.effortMode || "auto");
    const credentials = this.gateway.credentials();
    const onEvent = input.onEvent || (() => undefined);
    const routeListener = (event: ClaudeGatewayRouteEvent) => {
      if (event.type === "error") {
        onEvent({ type: "status", message: `Fallback requis après ${event.provider}/${event.model}.` });
      } else {
        onEvent({
          type: event.type,
          provider: event.provider,
          model: event.model,
          previousProvider: event.previousProvider,
          previousModel: event.previousModel,
          reason: event.reason
        });
      }
    };
    const unsubscribe = this.gateway.onRoute(routeListener);

    const args = [
      "-p",
      prompt,
      "--model",
      "sonnet",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "acceptEdits",
      "--max-turns",
      "32"
    ];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: credentials.baseUrl,
      ANTHROPIC_AUTH_TOKEN: credentials.token,
      ANTHROPIC_API_KEY: credentials.token,
      ANTHROPIC_MODEL: "sophenic-auto",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "sophenic-auto",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "sophenic-auto",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "sophenic-auto",
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      DISABLE_AUTOUPDATER: "1"
    };

    const useShell = process.platform === "win32" && found.command.toLowerCase().endsWith(".cmd");
    const child = spawn(found.command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    this.currentRequestId = requestId;
    onEvent({ type: "status", message: `Claude Code ${found.version} exécute le plan Sophenic Brain.` });

    let stdoutBuffer = "";
    let stderr = "";
    let streamed = "";
    let finalText = "";
    let sessionId = "";

    const parseLine = (line: string) => {
      const text = line.trim();
      if (!text) return;
      try {
        const packet = JSON.parse(text) as Record<string, unknown>;
        if (packet.type === "stream_event" && packet.event && typeof packet.event === "object") {
          const event = packet.event as Record<string, unknown>;
          if (event.type === "content_block_delta" && event.delta && typeof event.delta === "object") {
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
              streamed += delta.text;
              onEvent({ type: "delta", text: delta.text });
            }
          }
          if (event.type === "content_block_start" && event.content_block && typeof event.content_block === "object") {
            const block = event.content_block as Record<string, unknown>;
            if (block.type === "tool_use" && typeof block.name === "string") onEvent({ type: "tool", name: block.name, input: block.input });
          }
        } else if (packet.type === "assistant" && packet.message && typeof packet.message === "object") {
          const message = packet.message as Record<string, unknown>;
          const content = Array.isArray(message.content) ? message.content : [];
          for (const entry of content) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            const block = entry as Record<string, unknown>;
            if (block.type === "tool_use" && typeof block.name === "string") onEvent({ type: "tool", name: block.name, input: block.input });
          }
        } else if (packet.type === "result") {
          const resultText = textFromResult(packet.result);
          if (resultText) finalText = resultText;
          if (typeof packet.session_id === "string") sessionId = packet.session_id;
          if (packet.is_error === true && typeof packet.result === "string") throw new Error(packet.result);
        } else if (packet.type === "system" && packet.subtype === "api_retry" && typeof packet.attempt === "number") {
          onEvent({ type: "status", message: `Claude Code réessaie la requête (${packet.attempt}).` });
        }
      } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        try { parseLine(line); } catch (error) { onEvent({ type: "error", message: cleanError(error) }); }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-12000); });

    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          if (stdoutBuffer.trim()) {
            try { parseLine(stdoutBuffer); } catch { /* final line best-effort */ }
          }
          if (code === 0) resolve();
          else reject(new Error(stderr.trim() || `Claude Code s’est arrêté avec le code ${code ?? "inconnu"}.`));
        });
      });
      const text = (finalText || streamed).trim();
      if (!text) throw new Error("Claude Code a terminé sans réponse exploitable.");
      const resolved = this.gateway.resolvedRoute() || brainPlan.primary;
      return {
        ok: true,
        text,
        sessionId: sessionId || undefined,
        provider: resolved.provider,
        model: resolved.model,
        fallbacks: brainPlan.fallbacks.map((candidate) => ({ provider: candidate.provider, model: candidate.model })),
        version: found.version
      };
    } catch (error) {
      onEvent({ type: "error", message: cleanError(error) });
      throw error;
    } finally {
      unsubscribe();
      this.child = null;
      this.currentRequestId = "";
      this.gateway.clearTask();
    }
  }

  dispose(): void {
    this.abort();
    this.gateway.stop();
  }
}
