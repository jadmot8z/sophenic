import { execFile, spawn } from "node:child_process";
import { validateCommand } from "../security-guard";

function execDocker(args: string[], timeoutMs = 120_000, cwd?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("docker", args, { cwd, windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.stdout?.on("data", (d) => { output += d.toString(); });
    child.stderr?.on("data", (d) => { output += d.toString(); });
    child.once("error", (error) => { clearTimeout(timer); resolve({ code: 1, output: error.message }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim().slice(-60_000) }); });
  });
}

export class DockerSandbox {
  async inspect(): Promise<{ installed: boolean; version: string | null; daemonReady: boolean; error?: string }> {
    return new Promise((resolve) => {
      execFile("docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], { timeout: 8_000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) return resolve({ installed: !/ENOENT/i.test(String(error)), version: null, daemonReady: false, error: String(stderr || error.message).trim().slice(0, 600) });
        const [client, server] = String(stdout || "").trim().split("|");
        resolve({ installed: true, version: client || null, daemonReady: Boolean(server) });
      });
    });
  }

  async run(image: string, command: string[], options: { cwd?: string; mounts?: Array<{ host: string; container: string; readOnly?: boolean }>; timeoutMs?: number } = {}) {
    if (!/^[a-z0-9][a-z0-9._/:@-]*$/i.test(image)) throw new Error("Image Docker invalide.");
    const args = ["run", "--rm"];
    for (const mount of options.mounts || []) {
      args.push("-v", `${mount.host}:${mount.container}${mount.readOnly ? ":ro" : ""}`);
    }
    args.push(image, ...command);
    validateCommand(`docker ${args.join(" ")}`);
    return { image, command, ...(await execDocker(args, options.timeoutMs || 300_000, options.cwd)) };
  }

  async compose(args: string[], cwd: string, timeoutMs = 300_000) {
    validateCommand(`docker compose ${args.join(" ")}`);
    return execDocker(["compose", ...args], timeoutMs, cwd);
  }
}
