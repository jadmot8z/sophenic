import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  githubOAuthCredentials,
  oauthCallbackUrl,
  oauthCookieOptions,
  safeEqual,
  saveDeveloperConnection
} from "@/lib/server/developer-connections";

const STATE_COOKIE = "sophenic_oauth_github_state";

type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

type GitHubUser = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  html_url?: string | null;
};

function finish(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/settings/connections?${query}`, request.url));
  response.cookies.set(STATE_COOKIE, "", { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const { user } = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  if (request.nextUrl.searchParams.get("error")) return finish(request, "error=github_denied");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;
  const credentials = githubOAuthCredentials();
  if (!code || !safeEqual(state, storedState) || !credentials) return finish(request, "error=github_callback");

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: oauthCallbackUrl(request, "github")
      }),
      cache: "no-store"
    });
    const token = await tokenResponse.json() as GitHubTokenResponse;
    if (!tokenResponse.ok || !token.access_token || token.error) throw new Error("Échange OAuth GitHub refusé");

    const profileResponse = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10"
      },
      cache: "no-store"
    });
    if (!profileResponse.ok) throw new Error("Profil GitHub indisponible");
    const profile = await profileResponse.json() as GitHubUser;
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

    await saveDeveloperConnection({
      userId: user.id,
      provider: "github",
      secret: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        tokenType: token.token_type ?? "bearer",
        expiresAt
      },
      scopes: (token.scope || "").split(/[\s,]+/).filter(Boolean),
      metadata: {
        account_id: String(profile.id),
        username: profile.login,
        name: profile.name ?? null,
        avatar_url: profile.avatar_url ?? null,
        profile_url: profile.html_url ?? null,
        expires_at: expiresAt
      }
    });
    return finish(request, "connected=github");
  } catch {
    return finish(request, "error=github_callback");
  }
}
