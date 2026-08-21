import { spawn } from "node:child_process";
import { readConnectorSecret, writeConnectorSecret } from "../connector-secrets";

function tokenValue(explicit?: string): string { return (explicit || process.env.SOPHENIC_VERCEL_TOKEN || process.env.VERCEL_TOKEN || "").trim(); }
function redact(value: string): string { return value.replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{20,}/g, "[secret]"); }

export class VercelConnector {
  private token = "";
  constructor(token?: string) { this.token = tokenValue(token); }
  connected(): boolean { return Boolean(this.getToken()); }
  setToken(token: string, persist = true): void { this.token = token.trim(); if (persist && this.token) try { writeConnectorSecret("vercel", this.token); } catch { /* memory-only when OS encryption is unavailable; never plaintext */ } }
  private getToken(): string { return this.token || tokenValue() || readConnectorSecret("vercel"); }

  async validate(): Promise<{ connected: boolean; username?: string }> {
    const token = this.getToken();
    if (!token) return { connected: false };
    const response = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Vercel HTTP ${response.status}: ${redact(text).slice(0, 500)}`);
    const body = JSON.parse(text) as { user?: { username?: string; name?: string } };
    return { connected: true, username: body.user?.username || body.user?.name };
  }

  async logs(deployment: string, limit = 120): Promise<{ code: number; output: string }> {
    const token = this.getToken();
    if (!token) throw new Error("Vercel n’est pas connecté.");
    const target = deployment.trim();
    if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app\/?$/i.test(target)) throw new Error("URL de déploiement Vercel invalide.");
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["vercel", "logs", target, "--token", token];
    return new Promise((resolve) => {
      let output = "";
      const child = spawn(executable, args, { windowsHide: true, env: { ...process.env, VERCEL_TOKEN: token } });
      const append = (chunk: Buffer | string) => { output += chunk.toString(); if (output.length > 80_000) output = output.slice(-80_000); };
      child.stdout?.on("data", append); child.stderr?.on("data", append);
      const timer = setTimeout(() => { try { child.kill(); } catch {} }, 30_000);
      child.once("error", (error) => { clearTimeout(timer); resolve({ code: 1, output: error.message }); });
      child.once("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: redact(output).trim().split(/\r?\n/).slice(-Math.max(10, Math.min(500, limit))).join("\n") }); });     });
  }

  async deploy(cwd: string, options: { production?: boolean } = {}): Promise<{ code: number; output: string; url?: string }> {
    const token = this.getToken();
    if (!token) throw new Error("Vercel n’est pas connecté. Configure SOPHENIC_VERCEL_TOKEN ou VERCEL_TOKEN.");
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["vercel", "deploy", "--yes", ...(options.production === false ? [] : ["--prod"]), "--token", token];
    return new Promise((resolve) => {
      let output = "";
      const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env, VERCEL_TOKEN: token } });
      child.stdout?.on("data", (d) => { output += d.toString(); });
      child.stderr?.on("data", (d) => { output += d.toString(); });
      child.once("error", (error) => resolve({ code: 1, output: error.message }));
      child.once("close", (code) => {
        const clean = redact(output).trim().slice(-40_000);
        const urls = clean.match(/https:\/\/[a-z0-9.-]+\.vercel\.app\b/gi) || [];
        resolve({ code: code ?? 1, output: clean, ...(urls.length ? { url: urls.at(-1) } : {}) });
      });
    });
  }
}
