import { spawn } from "node:child_process";
import os from "node:os";

export type EnvironmentToolId = "node" | "npm" | "git" | "python" | "docker" | "playwright";
export type EnvironmentToolStatus = { id: EnvironmentToolId; installed: boolean; version?: string; installCommand?: string; required: boolean };

function run(command: string, args: string[], timeoutMs = 8_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    const child = spawn(command, args, { windowsHide: true, shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command) });
    const finish = (code: number) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, output: output.trim().slice(0, 1000) }); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(124); }, timeoutMs);
    child.stdout?.on("data", (d) => { output += d.toString(); });
    child.stderr?.on("data", (d) => { output += d.toString(); });
    child.once("error", () => finish(1));
    child.once("close", (code) => finish(code ?? 1));
  });
}

function windowsInstallCommand(id: EnvironmentToolId): string | undefined {
  if (process.platform !== "win32") return undefined;
  const ids: Partial<Record<EnvironmentToolId, string>> = {
    node: "winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements",
    git: "winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements",
    python: "winget install --id Python.Python.3.13 -e --accept-package-agreements --accept-source-agreements",
    docker: "winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements"
  };
  if (id === "npm") return "npm est installé avec Node.js";
  if (id === "playwright") return "npm install && npx playwright install chromium";
  return ids[id];
}

export class EnvironmentManager {
  async inspect(): Promise<{ platform: string; arch: string; tools: EnvironmentToolStatus[]; readyForDevelopment: boolean }> {
    const probes: Array<{ id: EnvironmentToolId; command: string; args: string[]; required: boolean }> = [
      { id: "node", command: "node", args: ["--version"], required: true },
      { id: "npm", command: process.platform === "win32" ? "npm.cmd" : "npm", args: ["--version"], required: true },
      { id: "git", command: "git", args: ["--version"], required: true },
      { id: "python", command: process.platform === "win32" ? "python" : "python3", args: ["--version"], required: false },
      { id: "docker", command: "docker", args: ["--version"], required: false },
      { id: "playwright", command: process.platform === "win32" ? "npx.cmd" : "npx", args: ["playwright", "--version"], required: false }
    ];
    const tools = await Promise.all(probes.map(async (probe): Promise<EnvironmentToolStatus> => {
      const result = await run(probe.command, probe.args);
      return { id: probe.id, installed: result.code === 0, ...(result.code === 0 ? { version: result.output.split(/\r?\n/)[0] } : {}), ...(windowsInstallCommand(probe.id) ? { installCommand: windowsInstallCommand(probe.id) } : {}), required: probe.required };
    }));
    return { platform: `${os.platform()} ${os.release()}`, arch: os.arch(), tools, readyForDevelopment: tools.filter((item) => item.required).every((item) => item.installed) };
  }
}
