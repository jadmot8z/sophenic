import { spawn } from "node:child_process";
import { validateCommand } from "./security-guard";

export type TerminalShell = "auto" | "powershell" | "cmd" | "bash";
export type SafeCommandResult = { code: number; output: string; durationMs: number; shell: Exclude<TerminalShell, "auto"> };

function resolveShell(shell: TerminalShell): Exclude<TerminalShell, "auto"> {
  if (shell !== "auto") return shell;
  return process.platform === "win32" ? "powershell" : "bash";
}

export function runSafeCommand(command: string, cwd?: string, options: { shell?: TerminalShell; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<SafeCommandResult> {
  validateCommand(command);
  const shell = resolveShell(options.shell || "auto");
  const timeoutMs = Math.max(1_000, Math.min(options.timeoutMs || 120_000, 900_000));
  const started = Date.now();
  const executable = shell === "powershell" ? "powershell.exe" : shell === "cmd" ? "cmd.exe" : "bash";
  const args = shell === "powershell"
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
    : shell === "cmd"
      ? ["/d", "/s", "/c", command]
      : ["-lc", command];

  if (process.platform !== "win32" && (shell === "powershell" || shell === "cmd")) {
    return Promise.reject(new Error(`${shell} est disponible uniquement sous Windows.`));
  }

  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, ...options.env } });
    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > 80_000) output = output.slice(-80_000);
    };
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: output.trim(), durationMs: Date.now() - started, shell });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      append(`\n[SOPHENIC] Commande arrêtée après ${timeoutMs} ms.`);
      finish(124);
    }, timeoutMs);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.once("close", (code) => finish(code ?? 1));
  });
}
