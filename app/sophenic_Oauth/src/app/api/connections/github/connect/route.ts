import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  githubOAuthCredentials,
  githubScopes,
  oauthCallbackUrl,
  oauthCookieOptions,
  randomOAuthValue
} from "@/lib/server/developer-connections";

const STATE_COOKIE = "sophenic_oauth_github_state";

export async function GET(request: NextRequest) {
  const { user } = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const credentials = githubOAuthCredentials();
  if (!credentials) return NextResponse.redirect(new URL("/settings/connections?error=github_config", request.url));

  const state = randomOAuthValue();
  const callbackUrl = oauthCallbackUrl(request, "github");
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl,
    scope: githubScopes(),
    state
  });

  const response = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  response.cookies.set(STATE_COOKIE, state, oauthCookieOptions());
  return response;
}
