import { spawn } from "node:child_process";
import { readConnectorSecret, writeConnectorSecret } from "../connector-secrets";

export type GithubDeviceFlow = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };

function ghToken(explicit?: string): string { return (explicit || process.env.SOPHENIC_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim(); }

async function githubJson(url: string, init: RequestInit, token?: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${String(payload.message || text || "Erreur")}`);
  return payload;
}

function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("git", args, { cwd, windowsHide: true, env: { ...process.env, ...env } });
    child.stdout?.on("data", (d) => { output += d.toString(); });
    child.stderr?.on("data", (d) => { output += d.toString(); });
    child.once("error", (error) => resolve({ code: 1, output: error.message }));
    child.once("close", (code) => resolve({ code: code ?? 1, output: output.trim().slice(-30_000) }));
  });
}

export class GithubConnector {
  private token = "";
  constructor(token?: string) { this.token = ghToken(token); }

  connected(): boolean { return Boolean(this.getToken()); }
  setToken(token: string, persist = true): void { this.token = token.trim(); if (persist && this.token) try { writeConnectorSecret("github", this.token); } catch { /* memory-only when OS encryption is unavailable; never plaintext */ } }
  private getToken(): string { return this.token || ghToken() || readConnectorSecret("github"); }

  async validate(): Promise<{ connected: boolean; login?: string }> {
    const token = this.getToken();
    if (!token) return { connected: false };
    const user = await githubJson("https://api.github.com/user", { method: "GET" }, token);
    return { connected: true, login: typeof user.login === "string" ? user.login : undefined };
  }

  async startOAuthDeviceFlow(clientId = process.env.SOPHENIC_GITHUB_CLIENT_ID || ""): Promise<GithubDeviceFlow> {
    if (!clientId.trim()) throw new Error("SOPHENIC_GITHUB_CLIENT_ID est requis pour OAuth GitHub Device Flow.");
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId.trim(), scope: "repo read:user user:email" }),
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof body.device_code !== "string") throw new Error(String(body.error_description || body.error || "GitHub OAuth indisponible"));
    return { deviceCode: body.device_code, userCode: String(body.user_code || ""), verificationUri: String(body.verification_uri || "https://github.com/login/device"), expiresIn: Number(body.expires_in || 900), interval: Number(body.interval || 5) };
  }

  async pollOAuthDeviceFlow(deviceCode: string, clientId = process.env.SOPHENIC_GITHUB_CLIENT_ID || ""): Promise<{ accessToken?: string; pending: boolean }> {
    if (!clientId.trim()) throw new Error("SOPHENIC_GITHUB_CLIENT_ID est requis.");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId.trim(), device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.access_token === "string") { this.setToken(body.access_token); return { accessToken: body.access_token, pending: false }; }
    if (body.error === "authorization_pending" || body.error === "slow_down") return { pending: true };
    throw new Error(String(body.error_description || body.error || "GitHub OAuth a échoué"));
  }

  async searchRepositories(query: string, limit = 8): Promise<Array<{ name: string; fullName: string; url: string; description?: string; stars?: number }>> {
    const token = this.getToken();
    const payload = await githubJson(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.max(1, Math.min(20, limit))}`, { method: "GET" }, token || undefined);
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((raw) => raw && typeof raw === "object" ? raw as Record<string, unknown> : {}).map((row) => ({
      name: String(row.name || ""), fullName: String(row.full_name || ""), url: String(row.html_url || ""),
      ...(row.description ? { description: String(row.description) } : {}), ...(typeof row.stargazers_count === "number" ? { stars: row.stargazers_count } : {})
    })).filter((row) => row.url);
  }

  async searchCode(query: string, limit = 8): Promise<Array<{ name: string; path: string; url: string; repository: string }>> {
    const token = this.getToken();
    if (!token) throw new Error("GitHub doit être connecté pour la recherche de code.");
    const payload = await githubJson(`https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${Math.max(1, Math.min(20, limit))}`, { method: "GET" }, token);
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((raw) => raw && typeof raw === "object" ? raw as Record<string, unknown> : {}).map((row) => {
      const repo = row.repository && typeof row.repository === "object" ? row.repository as Record<string, unknown> : {};
      return { name: String(row.name || ""), path: String(row.path || ""), url: String(row.html_url || ""), repository: String(repo.full_name || "") };
    }).filter((row) => row.url);
  }

  async createRepository(name: string, options: { description?: string; private?: boolean } = {}) {
    const token = this.getToken();
    if (!token) throw new Error("GitHub n’est pas connecté.");
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) throw new Error("Nom de repository GitHub invalide.");
    return githubJson("https://api.github.com/user/repos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: options.description || "", private: options.private !== false, auto_init: false }) }, token);
  }

  async commitAll(cwd: string, message: string): Promise<{ code: number; output: string }> {
    const add = await runGit(["add", "-A"], cwd);
    if (add.code !== 0) return add;
    return runGit(["commit", "-m", message.slice(0, 200)], cwd);
  }

  async push(cwd: string, remote = "origin", branch = ""): Promise<{ code: number; output: string }> {
    const token = this.getToken();
    const args = ["push", remote, ...(branch ? [branch] : [])];
    return runGit(args, cwd, token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {});
  }
}
