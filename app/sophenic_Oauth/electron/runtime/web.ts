import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`L'interface locale Sophenic s'est arrêtée (code ${child.exitCode}).`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_200) });
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error(`Timeout du serveur UI local Sophenic${lastError ? `: ${lastError}` : ""}`);
}

export class DesktopWebRuntime {
  private child: ChildProcess | null = null;
  private currentUrl = "";
  private logs: string[] = [];

  url(): string { return this.currentUrl; }
  recentLogs(): string[] { return [...this.logs]; }

  async start(serverScript: string): Promise<string> {
    if (this.child && this.child.exitCode === null && this.currentUrl) return this.currentUrl;
    if (!fs.existsSync(serverScript)) throw new Error(`UI Desktop Sophenic introuvable: ${serverScript}`);

    const port = await freeLoopbackPort();
    const origin = `http://127.0.0.1:${port}`;
    const url = `${origin}/desktop/agent`;
    const child = spawn(process.execPath, [serverScript], {
      cwd: path.dirname(serverScript),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
        NEXT_PUBLIC_APP_URL: origin
      }
    });
    this.child = child;
    const consume = (chunk: Buffer, source: "stdout" | "stderr") => {
      for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
        this.logs = [...this.logs, `[${source}] ${line}`].slice(-120);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    child.on("exit", () => { if (this.child === child) { this.child = null; this.currentUrl = ""; } });

    try {
      await waitForHttp(url, child);
      this.currentUrl = url;
      return url;
    } catch (error) {
      try { child.kill(); } catch { /* already stopped */ }
      this.child = null;
      this.currentUrl = "";
      throw error;
    }
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.currentUrl = "";
    if (child && child.exitCode === null) {
      try { child.kill(); } catch { /* already stopped */ }
    }
  }
}
