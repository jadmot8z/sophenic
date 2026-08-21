import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export type DeveloperProvider = "github" | "vercel";

export type StoredOAuthSecret = {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: string | null;
};

export type ConnectionMetadata = {
  account_id?: string | null;
  username?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  profile_url?: string | null;
  expires_at?: string | null;
  connected_at: string;
};

const CONNECTION_AAD = Buffer.from("sophenic:developer-connections:v1", "utf8");

function optional(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function githubOAuthCredentials() {
  const clientId = optional("SOPHENIC_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID");
  const clientSecret = optional("SOPHENIC_GITHUB_CLIENT_SECRET", "GITHUB_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function vercelOAuthCredentials() {
  const clientId = optional("SOPHENIC_VERCEL_CLIENT_ID", "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID", "VERCEL_CLIENT_ID");
  const clientSecret = optional("SOPHENIC_VERCEL_CLIENT_SECRET", "VERCEL_APP_CLIENT_SECRET", "VERCEL_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function githubScopes() {
  return optional("SOPHENIC_GITHUB_OAUTH_SCOPES") || "read:user user:email repo";
}

export function vercelScopes() {
  return optional("SOPHENIC_VERCEL_OAUTH_SCOPES") || "openid email profile offline_access";
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 10 * 60,
    path: "/"
  };
}

export function oauthCallbackUrl(request: Request, provider: DeveloperProvider) {
  const requestOrigin = new URL(request.url).origin;
  const configuredBase = process.env.SOPHENIC_OAUTH_BASE_URL?.trim();
  const origin = configuredBase ? new URL(configuredBase).origin : requestOrigin;
  return `${origin}/api/connections/${provider}/callback`;
}

export function randomOAuthValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createPkcePair() {
  const verifier = randomOAuthValue(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function safeEqual(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function encryptionKey() {
  const master = process.env.SOPHENIC_CONNECTIONS_ENCRYPTION_KEY?.trim() || env.supabaseServiceRoleKey();
  return createHash("sha256").update(master, "utf8").digest();
}

export function encryptOAuthSecret(secret: StoredOAuthSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(CONNECTION_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(secret), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return ["enc", "v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptOAuthSecret(value: string) {
  const [prefix, version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (prefix !== "enc" || version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Format de secret de connexion invalide");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(CONNECTION_AAD);
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(plaintext) as StoredOAuthSecret;
}

export async function saveDeveloperConnection(args: {
  userId: string;
  provider: DeveloperProvider;
  secret: StoredOAuthSecret;
  scopes: string[];
  metadata: Omit<ConnectionMetadata, "connected_at">;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("tool_connections").upsert({
    user_id: args.userId,
    provider: args.provider,
    status: "connected",
    secret_reference: encryptOAuthSecret(args.secret),
    scopes: args.scopes,
    metadata: { ...args.metadata, connected_at: now },
    updated_at: now
  }, { onConflict: "user_id,provider" });
  if (error) throw new Error(`Impossible d'enregistrer la connexion ${args.provider}`);
}

export async function loadDeveloperConnectionSecret(userId: string, provider: DeveloperProvider) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("tool_connections")
    .select("secret_reference,status")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`Impossible de lire la connexion ${provider}`);
  if (!data?.secret_reference || data.status !== "connected") return null;
  return decryptOAuthSecret(data.secret_reference);
}

export async function markDeveloperConnectionDisconnected(userId: string, provider: DeveloperProvider) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("tool_connections").upsert({
    user_id: userId,
    provider,
    status: "disconnected",
    secret_reference: null,
    scopes: [],
    metadata: { disconnected_at: now },
    updated_at: now
  }, { onConflict: "user_id,provider" });
  if (error) throw new Error(`Impossible de déconnecter ${provider}`);
}

export function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
