import { app, shell } from "electron";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { readConnectorSecret, writeConnectorSecret, clearConnectorSecret } from "./code-engine/connector-secrets";
import type { GithubConnector } from "./code-engine/connectors/github";
import type { VercelConnector } from "./code-engine/connectors/vercel";

export type DeveloperOAuthProvider = "github" | "vercel";

export type DeveloperOAuthConnection = {
  provider: DeveloperOAuthProvider;
  connected: boolean;
  username?: string;
  name?: string;
  accountId?: string;
  scopes: string[];
  connectedAt?: string;
  expiresAt?: string;
};

type OAuthBundle = {
  provider: DeveloperOAuthProvider;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  credentialType?: "oauth" | "personal_access_token";
  scopes: string[];
  accountId?: string;
  username?: string;
  name?: string;
  connectedAt: string;
  expiresAt?: string;
};

type CodeConnectors = {
  github: GithubConnector;
  vercel: VercelConnector;
};

const DEFAULT_LOOPBACK_PORT = 43821;
const FLOW_TIMEOUT_MS = 4 * 60_000;
let envFileCache: Record<string, string> | null = null;

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return key ? [key, value] : null;
}

function readEnvFile(target: string, values: Record<string, string>): void {
  if (!fs.existsSync(target)) return;
  try {
    for (const line of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
      const pair = parseEnvLine(line);
      if (pair && values[pair[0]] === undefined) values[pair[0]] = pair[1];
    }
  } catch {
    // A malformed optional env file must not crash the desktop runtime.
  }
}

// Stable, per-user configuration file for the INSTALLED desktop application.
// The packaged app never depends on the project folder or on process.cwd():
// %APPDATA%/SOPHENIC/sophenic.env (Windows) replaces .env.local once installed.
export function desktopEnvFile(): string | null {
  try {
    if (!app.isPackaged && !app.isReady()) return null;
    return path.join(app.getPath("userData"), "sophenic.env");
  } catch {
    return null;
  }
}

function localEnv(): Record<string, string> {
  if (envFileCache) return envFileCache;
  const values: Record<string, string> = {};
  // Installed-app source first (stable userData location), then dev sources.
  const userFile = desktopEnvFile();
  if (userFile) readEnvFile(userFile, values);
  for (const fileName of [".env.local", ".env"]) {
    readEnvFile(path.join(process.cwd(), fileName), values);
  }
  envFileCache = values;
  return values;
}

function oauthEnv(...names: string[]): string {
  const file = localEnv();
  for (const name of names) {
    const value = process.env[name]?.trim() || file[name]?.trim();
    if (value) return value;
  }
  return "";
}

function loopbackPort(): number {
  const raw = Number(oauthEnv("SOPHENIC_OAUTH_LOOPBACK_PORT"));
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : DEFAULT_LOOPBACK_PORT;
}

function vercelConfiguredToken(): string {
  return oauthEnv("SOPHENIC_VERCEL_TOKEN", "VERCEL_TOKEN");
}

function validGithubClientId(value: string): boolean {
  return /^[A-Za-z0-9_]{10,200}$/.test(value);
}

function callbackUrl(provider: DeveloperOAuthProvider): string {
  return `http://127.0.0.1:${loopbackPort()}/oauth/${provider}/callback`;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function bundleName(provider: DeveloperOAuthProvider): string {
  return `${provider}-oauth`;
}

function readBundle(provider: DeveloperOAuthProvider): OAuthBundle | null {
  const raw = readConnectorSecret(bundleName(provider));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthBundle;
    if (parsed.provider !== provider || !parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBundle(bundle: OAuthBundle): void {
  writeConnectorSecret(bundleName(bundle.provider), JSON.stringify(bundle));
  writeConnectorSecret(bundle.provider, bundle.accessToken);
}

function clearBundle(provider: DeveloperOAuthProvider): void {
  clearConnectorSecret(bundleName(provider));
  clearConnectorSecret(provider);
}

function htmlPage(title: string, message: string, ok: boolean): string {
  const accent = ok ? "#15803d" : "#b91c1c";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f7f4ee;color:#211d18;display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:560px;margin:24px;padding:32px;border:1px solid #e3d7c5;border-radius:24px;background:#fffdf8;box-shadow:0 18px 70px rgba(60,45,20,.12)}h1{font-size:24px;margin:0 0 12px;color:${accent}}p{line-height:1.6;margin:0;color:#62584c}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

async function waitForCallback(provider: DeveloperOAuthProvider, state: string): Promise<{ code: string }> {
  const expectedPath = `/oauth/${provider}/callback`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch {}
      if (error) reject(error);
      else if (code) resolve({ code });
      else reject(new Error("Callback OAuth incomplet."));
    };

    const server = http.createServer((request, response) => {
      const target = new URL(request.url || "/", `http://127.0.0.1:${loopbackPort()}`);
      if (target.pathname !== expectedPath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const returnedState = target.searchParams.get("state") || "";
      const code = target.searchParams.get("code") || "";
      const oauthError = target.searchParams.get("error") || "";
      if (!returnedState || !secureEqual(returnedState, state)) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(htmlPage("Connexion refusée", "Le paramètre de sécurité OAuth est invalide. Retourne dans SOPHENIC et réessaie.", false));
        finish(new Error("État OAuth invalide."));
        return;
      }
      if (oauthError || !code) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end(htmlPage("Connexion annulée", "L’autorisation n’a pas été accordée. Tu peux fermer cette fenêtre.", false));
        finish(new Error(`Autorisation ${provider} annulée ou refusée.`));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(htmlPage("Connexion réussie", `${provider === "github" ? "GitHub" : "Vercel"} est maintenant connecté à SOPHENIC. Tu peux fermer cette fenêtre et revenir dans l’application.`, true));
      finish(undefined, code);
    });

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") finish(new Error(`Le port OAuth ${loopbackPort()} est déjà utilisé. Ferme l’application qui l’utilise ou change SOPHENIC_OAUTH_LOOPBACK_PORT dans .env.local.`));
      else finish(error);
    });
    server.listen(loopbackPort(), "127.0.0.1");
    const timer = setTimeout(() => finish(new Error("Délai OAuth expiré. Relance la connexion depuis SOPHENIC.")), FLOW_TIMEOUT_MS);
    timer.unref?.();
  });
}

async function githubConnect(connectors: CodeConnectors): Promise<void> {
  const clientId = oauthEnv("SOPHENIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID");
  const clientSecret = oauthEnv("SOPHENIC_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GitHub OAuth n’est pas configuré. Ajoute SOPHENIC_GITHUB_CLIENT_ID et SOPHENIC_GITHUB_CLIENT_SECRET dans le fichier .env.local à la racine du projet.");
  }
  if (!validGithubClientId(clientId)) {
    throw new Error("SOPHENIC_GITHUB_CLIENT_ID est invalide. Relance `npm run oauth:setup` et utilise uniquement le Client ID GitHub (par exemple Ov23...), pas une commande npm.");
  }

  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const redirectUri = callbackUrl("github");
  const scopes = (oauthEnv("SOPHENIC_GITHUB_OAUTH_SCOPES") || "read:user user:email repo").split(/\s+/).filter(Boolean);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  const callbackPromise = waitForCallback("github", state);
  await shell.openExternal(`https://github.com/login/oauth/authorize?${params.toString()}`);
  const { code } = await callbackPromise;

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const token = await tokenResponse.json() as { access_token?: string; token_type?: string; scope?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || token.error || "GitHub a refusé l’échange du code OAuth.");

  const profileResponse = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": `Bearer ${token.access_token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10"
    },
    signal: AbortSignal.timeout(30_000)
  });
  const profile = await profileResponse.json() as { id?: number; login?: string; name?: string | null; message?: string };
  if (!profileResponse.ok || !profile.login) throw new Error(profile.message || "GitHub n’a pas renvoyé le profil autorisé.");
  const now = new Date().toISOString();
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined;
  const bundle: OAuthBundle = {
    provider: "github",
    accessToken: token.access_token,
    credentialType: "oauth",
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(token.token_type ? { tokenType: token.token_type } : {}),
    scopes: (token.scope || scopes.join(" ")).split(/[\s,]+/).filter(Boolean),
    ...(profile.id ? { accountId: String(profile.id) } : {}),
    username: profile.login,
    ...(profile.name ? { name: profile.name } : {}),
    connectedAt: now,
    ...(expiresAt ? { expiresAt } : {})
  };
  writeBundle(bundle);
  connectors.github.setToken(bundle.accessToken, false);
}

async function vercelConnect(connectors: CodeConnectors): Promise<void> {
  // Desktop default: a Vercel Personal Access Token (vcp_...) is enough for the
  // REST API and Vercel CLI used by SOPHENIC. It is never exposed in the UI and
  // is copied into Electron safeStorage after validation. OAuth App mode remains
  // supported as an optional fallback when Client ID / Secret are configured.
  const configuredToken = vercelConfiguredToken();
  if (configuredToken) {
    connectors.vercel.setToken(configuredToken, false);
    const validated = await connectors.vercel.validate();
    if (!validated.connected) throw new Error("Le jeton Vercel configuré n’a pas pu être validé.");
    const bundle: OAuthBundle = {
      provider: "vercel",
      accessToken: configuredToken,
      tokenType: "Bearer",
      credentialType: "personal_access_token",
      scopes: ["vercel-api"],
      ...(validated.username ? { username: validated.username } : {}),
      connectedAt: new Date().toISOString()
    };
    writeBundle(bundle);
    return;
  }

  const clientId = oauthEnv("SOPHENIC_VERCEL_CLIENT_ID", "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_CLIENT_ID");
  const clientSecret = oauthEnv("SOPHENIC_VERCEL_CLIENT_SECRET", "VERCEL_APP_CLIENT_SECRET", "VERCEL_CLIENT_SECRET");
  const authMethod = (oauthEnv("SOPHENIC_VERCEL_CLIENT_AUTH") || "client_secret_post").toLowerCase();
  if (!clientId || (authMethod !== "none" && !clientSecret)) {
    throw new Error("Vercel n’est pas configuré. Pour SOPHENIC Desktop, ajoute un Personal Access Token dans SOPHENIC_VERCEL_TOKEN (recommandé). Le mode OAuth App avec Client ID / Secret reste optionnel.");
  }
  if (!["client_secret_post", "client_secret_basic", "none"].includes(authMethod)) throw new Error("SOPHENIC_VERCEL_CLIENT_AUTH doit être client_secret_post, client_secret_basic ou none.");

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const redirectUri = callbackUrl("vercel");
  const scopes = (oauthEnv("SOPHENIC_VERCEL_OAUTH_SCOPES") || "openid email profile offline_access").split(/\s+/).filter(Boolean);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  const callbackPromise = waitForCallback("vercel", state);
  await shell.openExternal(`https://vercel.com/oauth/authorize?${params.toString()}`);
  const { code } = await callbackPromise;

  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  });
  const tokenHeaders: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (authMethod === "client_secret_post" && clientSecret) tokenParams.set("client_secret", clientSecret);
  if (authMethod === "client_secret_basic" && clientSecret) tokenHeaders.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const tokenResponse = await fetch("https://api.vercel.com/login/oauth/token", {
    method: "POST",
    headers: tokenHeaders,
    body: tokenParams,
    signal: AbortSignal.timeout(30_000)
  });
  const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || token.error || "Vercel a refusé l’échange du code OAuth.");

  const profileResponse = await fetch("https://api.vercel.com/login/oauth/userinfo", {
    headers: { "Authorization": `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(30_000)
  });
  const profile = await profileResponse.json() as { sub?: string; preferred_username?: string; name?: string; email?: string; error?: string };
  if (!profileResponse.ok || !profile.sub) throw new Error(profile.error || "Vercel n’a pas renvoyé le profil autorisé.");
  const now = new Date().toISOString();
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined;
  const bundle: OAuthBundle = {
    provider: "vercel",
    accessToken: token.access_token,
    credentialType: "oauth",
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(token.token_type ? { tokenType: token.token_type } : {}),
    scopes: (token.scope || scopes.join(" ")).split(/\s+/).filter(Boolean),
    accountId: profile.sub,
    ...(profile.preferred_username ? { username: profile.preferred_username } : {}),
    ...(profile.name ? { name: profile.name } : {}),
    connectedAt: now,
    ...(expiresAt ? { expiresAt } : {})
  };
  writeBundle(bundle);
  connectors.vercel.setToken(bundle.accessToken, false);
}

async function refreshVercelBundle(connectors: CodeConnectors, bundle: OAuthBundle): Promise<OAuthBundle> {
  if (bundle.credentialType === "personal_access_token" || !bundle.refreshToken) return bundle;
  const expiresAt = bundle.expiresAt ? Date.parse(bundle.expiresAt) : 0;
  if (expiresAt && expiresAt - Date.now() > 5 * 60_000) return bundle;

  const clientId = oauthEnv("SOPHENIC_VERCEL_CLIENT_ID", "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_CLIENT_ID");
  const clientSecret = oauthEnv("SOPHENIC_VERCEL_CLIENT_SECRET", "VERCEL_APP_CLIENT_SECRET", "VERCEL_CLIENT_SECRET");
  const authMethod = (oauthEnv("SOPHENIC_VERCEL_CLIENT_AUTH") || "client_secret_post").toLowerCase();
  if (!clientId || (authMethod !== "none" && !clientSecret)) return bundle;

  const params = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: bundle.refreshToken });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (authMethod === "client_secret_post" && clientSecret) params.set("client_secret", clientSecret);
  if (authMethod === "client_secret_basic" && clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const response = await fetch("https://api.vercel.com/login/oauth/token", {
    method: "POST",
    headers,
    body: params,
    signal: AbortSignal.timeout(30_000)
  });
  const token = await response.json() as { access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number; scope?: string };
  if (!response.ok || !token.access_token) return bundle;
  const updated: OAuthBundle = {
    ...bundle,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || bundle.refreshToken,
    tokenType: token.token_type || bundle.tokenType,
    scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : bundle.scopes,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : bundle.expiresAt
  };
  writeBundle(updated);
  connectors.vercel.setToken(updated.accessToken, false);
  return updated;
}

export async function restoreDeveloperOAuth(connectors: CodeConnectors): Promise<void> {
  const github = readBundle("github");
  if (github?.accessToken) connectors.github.setToken(github.accessToken, false);
  const vercel = readBundle("vercel");
  if (vercel?.accessToken) {
    const fresh = await refreshVercelBundle(connectors, vercel).catch(() => vercel);
    connectors.vercel.setToken(fresh.accessToken, false);
  }
}

async function connectionStatus(provider: DeveloperOAuthProvider, connectors: CodeConnectors): Promise<DeveloperOAuthConnection> {
  let bundle = readBundle(provider);
  if (provider === "vercel" && bundle) bundle = await refreshVercelBundle(connectors, bundle).catch(() => bundle);
  if (!bundle?.accessToken) return { provider, connected: false, scopes: [] };
  try {
    let connected = false;
    let username: string | undefined;
    if (provider === "github") {
      const validated = await connectors.github.validate();
      connected = validated.connected;
      username = validated.login;
    } else {
      const validated = await connectors.vercel.validate();
      connected = validated.connected;
      username = validated.username;
    }
    return {
      provider,
      connected,
      ...(username || bundle.username ? { username: username || bundle.username } : {}),
      ...(bundle.name ? { name: bundle.name } : {}),
      ...(bundle.accountId ? { accountId: bundle.accountId } : {}),
      scopes: bundle.scopes,
      connectedAt: bundle.connectedAt,
      ...(bundle.expiresAt ? { expiresAt: bundle.expiresAt } : {})
    };
  } catch {
    return {
      provider,
      connected: false,
      ...(bundle.username ? { username: bundle.username } : {}),
      ...(bundle.name ? { name: bundle.name } : {}),
      scopes: bundle.scopes,
      connectedAt: bundle.connectedAt,
      ...(bundle.expiresAt ? { expiresAt: bundle.expiresAt } : {})
    };
  }
}

export async function developerOAuthStatus(connectors: CodeConnectors): Promise<DeveloperOAuthConnection[]> {
  return Promise.all([connectionStatus("github", connectors), connectionStatus("vercel", connectors)]);
}

export async function connectDeveloperOAuth(provider: DeveloperOAuthProvider, connectors: CodeConnectors): Promise<DeveloperOAuthConnection[]> {
  if (provider === "github") await githubConnect(connectors);
  else await vercelConnect(connectors);
  return developerOAuthStatus(connectors);
}

// ---------------------------------------------------------------------------
// Personal Access Tokens entered manually by the user in the desktop app.
// They are validated against the real provider API BEFORE being stored, then
// persisted encrypted with Electron safeStorage inside userData. The raw token
// is never logged, never returned to the renderer and never written in clear.
// ---------------------------------------------------------------------------

function sanitizeTokenInput(provider: DeveloperOAuthProvider, token: string): string {
  const clean = token.trim();
  if (clean.length < 20 || /\s/.test(clean)) {
    throw new Error(provider === "github"
      ? "Clé/token GitHub invalide : colle un Personal Access Token GitHub complet (github_pat_… ou ghp_…)."
      : "Clé/token Vercel invalide : colle un Personal Access Token Vercel complet (vcp_…).");
  }
  if (!/^[A-Za-z0-9_.\-]+$/.test(clean)) throw new Error("Le token contient des caractères non autorisés.");
  return clean;
}

async function validateGithubToken(token: string): Promise<{ username?: string; name?: string; accountId?: string }> {
  const response = await fetch("https://api.github.com/user", {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const detail = response.status === 401 ? "GitHub a refusé ce token (invalide ou révoqué)." : `GitHub a répondu HTTP ${response.status}.`;
    throw new Error(detail);
  }
  const profile = await response.json() as { login?: string; name?: string; id?: number };
  return { username: profile.login, name: profile.name, ...(typeof profile.id === "number" ? { accountId: String(profile.id) } : {}) };
}

async function validateVercelToken(token: string): Promise<{ username?: string; name?: string; accountId?: string }> {
  const response = await fetch("https://api.vercel.com/v2/user", {
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    const detail = response.status === 401 ? "Vercel a refusé ce token (invalide, révoqué ou mauvaise portée)." : `Vercel a répondu HTTP ${response.status}.`;
    throw new Error(detail);
  }
  const body = await response.json() as { user?: { username?: string; name?: string; email?: string; id?: string } };
  return { username: body.user?.username || body.user?.email, name: body.user?.name, accountId: body.user?.id };
}

export async function saveDeveloperPersonalToken(provider: DeveloperOAuthProvider, token: string, connectors: CodeConnectors): Promise<DeveloperOAuthConnection[]> {
  const clean = sanitizeTokenInput(provider, token);
  let identity: { username?: string; name?: string; accountId?: string };
  try {
    identity = provider === "github" ? await validateGithubToken(clean) : await validateVercelToken(clean);
  } catch (error) {
    // Network/API failure: never persist an unverified credential.
    throw error instanceof Error ? error : new Error("Validation du token impossible.");
  }
  const bundle: OAuthBundle = {
    provider,
    accessToken: clean,
    credentialType: "personal_access_token",
    scopes: provider === "github" ? ["read:user", "repo"] : ["user"],
    ...(identity.username ? { username: identity.username } : {}),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.accountId ? { accountId: identity.accountId } : {}),
    connectedAt: new Date().toISOString()
  };
  writeBundle(bundle);
  if (provider === "github") connectors.github.setToken(bundle.accessToken, false);
  else connectors.vercel.setToken(bundle.accessToken, false);
  return developerOAuthStatus(connectors);
}

export async function disconnectDeveloperOAuth(provider: DeveloperOAuthProvider, connectors: CodeConnectors): Promise<DeveloperOAuthConnection[]> {  const bundle = readBundle(provider);
  try {
    if (bundle?.accessToken && provider === "github" && bundle.credentialType !== "personal_access_token") {
      const clientId = oauthEnv("SOPHENIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID");
      const clientSecret = oauthEnv("SOPHENIC_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET");
      if (clientId && clientSecret) {
        await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
          method: "DELETE",
          headers: {
            "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2026-03-10"
          },
          body: JSON.stringify({ access_token: bundle.accessToken }),
          signal: AbortSignal.timeout(20_000)
        });
      }
    } else if (bundle?.accessToken && provider === "vercel" && bundle.credentialType !== "personal_access_token") {
      const clientId = oauthEnv("SOPHENIC_VERCEL_CLIENT_ID", "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_CLIENT_ID");
      const clientSecret = oauthEnv("SOPHENIC_VERCEL_CLIENT_SECRET", "VERCEL_APP_CLIENT_SECRET", "VERCEL_CLIENT_SECRET");
      if (clientId) {
        const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
        if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
        await fetch("https://api.vercel.com/login/oauth/token/revoke", {
          method: "POST",
          headers,
          body: new URLSearchParams({ token: bundle.accessToken }),
          signal: AbortSignal.timeout(20_000)
        });
      }
    }
  } catch {
    // Local disconnect still proceeds if the provider is temporarily unreachable.
  }

  clearBundle(provider);
  if (provider === "github") connectors.github.setToken("", false);
  else connectors.vercel.setToken("", false);
  return developerOAuthStatus(connectors);
}

export function developerOAuthConfiguration() {
  const port = loopbackPort();
  return {
    port,
    github: {
      configured: Boolean(oauthEnv("SOPHENIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID") && oauthEnv("SOPHENIC_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET")),
      callbackUrl: `http://127.0.0.1:${port}/oauth/github/callback`
    },
    vercel: {
      configured: Boolean(vercelConfiguredToken()) || (Boolean(oauthEnv("SOPHENIC_VERCEL_CLIENT_ID", "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_CLIENT_ID")) && ((oauthEnv("SOPHENIC_VERCEL_CLIENT_AUTH") || "client_secret_post").toLowerCase() === "none" || Boolean(oauthEnv("SOPHENIC_VERCEL_CLIENT_SECRET", "VERCEL_APP_CLIENT_SECRET", "VERCEL_CLIENT_SECRET")))),
      mode: vercelConfiguredToken() ? "token" : "oauth",
      callbackUrl: `http://127.0.0.1:${port}/oauth/vercel/callback`
    }
  };
}
