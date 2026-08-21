import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  loadDeveloperConnectionSecret,
  markDeveloperConnectionDisconnected,
  vercelOAuthCredentials
} from "@/lib/server/developer-connections";

export async function POST() {
  const { user } = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let warning: string | undefined;
  try {
    const secret = await loadDeveloperConnectionSecret(user.id, "vercel");
    const credentials = vercelOAuthCredentials();
    if (secret?.accessToken && credentials) {
      const tokenToRevoke = secret.accessToken;
      const revoke = await fetch("https://api.vercel.com/login/oauth/token/revoke", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ token: tokenToRevoke }),
        cache: "no-store"
      });
      if (!revoke.ok) {
        if (secret.refreshToken) {
          const refreshRevoke = await fetch("https://api.vercel.com/login/oauth/token/revoke", {
            method: "POST",
            headers: {
              "Authorization": `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({ token: secret.refreshToken }),
            cache: "no-store"
          });
          if (!refreshRevoke.ok) warning = "La connexion locale est supprimée, mais Vercel n'a pas confirmé la révocation distante.";
        } else {
          warning = "La connexion locale est supprimée, mais Vercel n'a pas confirmé la révocation distante.";
        }
      }
    }
  } catch {
    warning = "La connexion locale est supprimée, mais la révocation Vercel n'a pas pu être vérifiée.";
  }

  await markDeveloperConnectionDisconnected(user.id, "vercel");
  return NextResponse.json({ ok: true, warning });
}
