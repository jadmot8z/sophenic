import { spawnSync } from "node:child_process";
import path from "node:path";

export type PowerShellResult = { status: number | null; stdout: string; stderr: string };

function powershellPath(): string {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function runWindowsPowerShell(script: string, env: Record<string, string> = {}, timeout = 20_000): PowerShellResult {
  if (process.platform !== "win32") return { status: 1, stdout: "", stderr: "Windows uniquement" };
  const result = spawnSync(powershellPath(), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: { ...process.env, ...env }
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}
