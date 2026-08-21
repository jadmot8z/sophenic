import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  createPkcePair,
  oauthCallbackUrl,
  oauthCookieOptions,
  randomOAuthValue,
  vercelOAuthCredentials,
  vercelScopes
} from "@/lib/server/developer-connections";

const STATE_COOKIE = "sophenic_oauth_vercel_state";
const NONCE_COOKIE = "sophenic_oauth_vercel_nonce";
const VERIFIER_COOKIE = "sophenic_oauth_vercel_verifier";

export async function GET(request: NextRequest) {
  const { user } = await getApiUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const credentials = vercelOAuthCredentials();
  if (!credentials) return NextResponse.redirect(new URL("/settings/connections?error=vercel_config", request.url));

  const state = randomOAuthValue();
  const nonce = randomOAuthValue();
  const { verifier, challenge } = createPkcePair();
  const callbackUrl = oauthCallbackUrl(request, "vercel");
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    response_type: "code",
    scope: vercelScopes()
  });

  const response = NextResponse.redirect(`https://vercel.com/oauth/authorize?${params.toString()}`);
  const options = oauthCookieOptions();
  response.cookies.set(STATE_COOKIE, state, options);
  response.cookies.set(NONCE_COOKIE, nonce, options);
  response.cookies.set(VERIFIER_COOKIE, verifier, options);
  return response;
}
