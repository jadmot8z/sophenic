import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import {
  githubOAuthCredentials,
  loadDeveloperConnectionSecret,
  markDeveloperConnectionDisconnected
} from "@/lib/server/developer-connections";

export async function POST() {
  const { user } = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let warning: string | undefined;
  try {
    const [secret, credentials] = await Promise.all([
      loadDeveloperConnectionSecret(user.id, "github"),
      Promise.resolve(githubOAuthCredentials())
    ]);

    if (secret?.accessToken && credentials) {
      const revoke = await fetch(`https://api.github.com/applications/${encodeURIComponent(credentials.clientId)}/token`, {
        method: "DELETE",
        headers: {
          "Authorization": `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10"
        },
        body: JSON.stringify({ access_token: secret.accessToken }),
        cache: "no-store"
      });
      if (!revoke.ok && revoke.status !== 404) warning = "La connexion locale est supprimée, mais GitHub n'a pas confirmé la révocation distante.";
    }
  } catch {
    warning = "La connexion locale est supprimée, mais la révocation GitHub n'a pas pu être vérifiée.";
  }

  await markDeveloperConnectionDisconnected(user.id, "github");
  return NextResponse.json({ ok: true, warning });
}
