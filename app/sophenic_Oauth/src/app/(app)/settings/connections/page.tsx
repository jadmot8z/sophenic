import { requireUser } from "@/lib/auth";
import { DeveloperConnectionsPanel, type DeveloperConnectionSummary } from "@/components/developer-connections-panel";

export const metadata = { title: "Connexions développeur" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const feedbackMessages: Record<string, string> = {
  github_config: "GitHub OAuth n'est pas configuré côté serveur. Ajoutez le Client ID et le Client Secret de l'application OAuth GitHub.",
  vercel_config: "Vercel OAuth n'est pas configuré côté serveur. Ajoutez le Client ID et le Client Secret de l'application Vercel.",
  github_denied: "Autorisation GitHub annulée.",
  vercel_denied: "Autorisation Vercel annulée.",
  github_callback: "La connexion GitHub n'a pas pu être finalisée. Vérifiez l'URL de callback et les identifiants OAuth.",
  vercel_callback: "La connexion Vercel n'a pas pu être finalisée. Vérifiez l'URL de callback, les permissions et les identifiants OAuth."
};

export default async function ConnectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, supabase } = await requireUser();
  const params = await searchParams;
  const { data } = await supabase.from("tool_connections")
    .select("provider,status,scopes,metadata")
    .eq("user_id", user.id)
    .in("provider", ["github", "vercel"]);

  const byProvider = new Map((data ?? []).map((row) => [row.provider, row]));
  const connections: DeveloperConnectionSummary[] = (["github", "vercel"] as const).map((provider) => {
    const row = byProvider.get(provider);
    const metadata = (row?.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
    return {
      provider,
      connected: row?.status === "connected",
      username: typeof metadata.username === "string" ? metadata.username : null,
      name: typeof metadata.name === "string" ? metadata.name : null,
      scopes: Array.isArray(row?.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : []
    };
  });

  const errorKey = typeof params.error === "string" ? params.error : null;
  const connectedProvider = typeof params.connected === "string" ? params.connected : null;

  return <main className="mx-auto max-w-5xl space-y-7 p-5 sm:p-8">
    <div>
      <p className="text-sm font-medium text-indigo-500">Paramètres</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Connexions développeur</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Connectez vos comptes avec les écrans d’autorisation officiels. Sophenic conserve les jetons chiffrés côté serveur et n’affiche jamais vos secrets dans l’interface.</p>
    </div>

    {connectedProvider === "github" || connectedProvider === "vercel" ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">{connectedProvider === "github" ? "GitHub" : "Vercel"} est maintenant connecté à Sophenic.</div> : null}
    {errorKey && feedbackMessages[errorKey] ? <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-900 dark:text-amber-100">{feedbackMessages[errorKey]}</div> : null}

    <DeveloperConnectionsPanel connections={connections} />

    <div className="rounded-2xl border border-zinc-200/80 bg-white/60 p-5 text-xs leading-6 text-zinc-500 dark:border-white/10 dark:bg-white/[0.025]">
      Les URLs de callback à enregistrer chez les fournisseurs sont <code>/api/connections/github/callback</code> et <code>/api/connections/vercel/callback</code> sur le domaine de Sophenic. Les permissions Vercel d’accès aux ressources se configurent dans l’application Vercel elle-même.
    </div>
  </main>;
}
