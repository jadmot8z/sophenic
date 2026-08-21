import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  decodeJwtPayload,
  oauthCallbackUrl,
  oauthCookieOptions,
  safeEqual,
  saveDeveloperConnection,
  vercelOAuthCredentials
} from "@/lib/server/developer-connections";

const STATE_COOKIE = "sophenic_oauth_vercel_state";
const NONCE_COOKIE = "sophenic_oauth_vercel_nonce";
const VERIFIER_COOKIE = "sophenic_oauth_vercel_verifier";

type VercelTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

type VercelUserInfo = {
  sub: string;
  name?: string | null;
  preferred_username?: string | null;
  email?: string | null;
  picture?: string | null;
};

function finish(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/settings/connections?${query}`, request.url));
  const expired = { ...oauthCookieOptions(), maxAge: 0 };
  response.cookies.set(STATE_COOKIE, "", expired);
  response.cookies.set(NONCE_COOKIE, "", expired);
  response.cookies.set(VERIFIER_COOKIE, "", expired);
  return response;
}

export async function GET(request: NextRequest) {
  const { user } = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (request.nextUrl.searchParams.get("error")) return finish(request, "error=vercel_denied");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  const storedNonce = request.cookies.get(NONCE_COOKIE)?.value;
  const verifier = request.cookies.get(VERIFIER_COOKIE)?.value;
  const credentials = vercelOAuthCredentials();
  if (!code || !safeEqual(state, storedState) || !verifier || !storedNonce || !credentials) return finish(request, "error=vercel_callback");

  try {
    const tokenResponse = await fetch("https://api.vercel.com/login/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: oauthCallbackUrl(request, "vercel")
      }),
      cache: "no-store"
    });
    const token = await tokenResponse.json() as VercelTokenResponse;
    if (!tokenResponse.ok || !token.access_token || token.error) throw new Error("Échange OAuth Vercel refusé");

    if (token.id_token) {
      const payload = decodeJwtPayload(token.id_token);
      if (!safeEqual(typeof payload?.nonce === "string" ? payload.nonce : null, storedNonce)) throw new Error("Nonce Vercel invalide");
    }

    const profileResponse = await fetch("https://api.vercel.com/login/oauth/userinfo", {
      headers: { "Authorization": `Bearer ${token.access_token}` },
      cache: "no-store"
    });
    if (!profileResponse.ok) throw new Error("Profil Vercel indisponible");
    const profile = await profileResponse.json() as VercelUserInfo;
    if (!profile.sub) throw new Error("Identité Vercel invalide");
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

    await saveDeveloperConnection({
      userId: user.id,
      provider: "vercel",
      secret: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenType: token.token_type ?? "Bearer",
        expiresAt
      },
      scopes: (token.scope || "").split(/\s+/).filter(Boolean),
      metadata: {
        account_id: profile.sub,
        username: profile.preferred_username ?? null,
        name: profile.name ?? null,
        email: profile.email ?? null,
        avatar_url: profile.picture ?? null,
        expires_at: expiresAt
      }
    });
    return finish(request, "connected=vercel");
  } catch {
    return finish(request, "error=vercel_callback");
  }
}
