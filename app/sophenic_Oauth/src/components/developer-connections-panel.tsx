"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Github, Link2, Triangle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export type DeveloperConnectionSummary = {
  provider: "github" | "vercel";
  connected: boolean;
  username?: string | null;
  name?: string | null;
  scopes: string[];
};

const providerCopy = {
  github: {
    name: "GitHub",
    description: "Autorise Sophenic via le flux OAuth officiel GitHub.",
    Icon: Github
  },
  vercel: {
    name: "Vercel",
    description: "Autorise Sophenic via le flux officiel Sign in with Vercel.",
    Icon: Triangle
  }
} as const;

export function DeveloperConnectionsPanel({ connections }: { connections: DeveloperConnectionSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"github" | "vercel" | null>(null);

  function connect(provider: "github" | "vercel") {
    setBusy(provider);
    window.location.assign(`/api/connections/${provider}/connect`);
  }

  async function disconnect(provider: "github" | "vercel") {
    setBusy(provider);
    try {
      const response = await fetch(`/api/connections/${provider}/disconnect`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { error?: string; warning?: string };
      if (!response.ok) throw new Error(result.error || `Impossible de déconnecter ${provider}`);
      if (result.warning) toast.warning(result.warning);
      else toast.success(`${provider === "github" ? "GitHub" : "Vercel"} déconnecté`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Déconnexion impossible");
    } finally {
      setBusy(null);
    }
  }

  return <div className="grid gap-4 lg:grid-cols-2">
    {connections.map((connection) => {
      const copy = providerCopy[connection.provider];
      const Icon = copy.Icon;
      const account = connection.username || connection.name;
      return <Card key={connection.provider} className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/[0.045]">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{copy.name}</h2>
                <Badge className={connection.connected ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""}>
                  {connection.connected ? "Connecté" : "Non connecté"}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-500">{copy.description}</p>
              {connection.connected && account ? <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><Link2 className="size-3.5" /><span className="truncate">Compte : {account}</span></div> : null}
              {connection.connected && connection.scopes.length ? <div className="mt-3 flex flex-wrap gap-1.5">{connection.scopes.slice(0, 6).map((scope) => <span key={scope} className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 dark:bg-white/[0.055] dark:text-zinc-400">{scope}</span>)}</div> : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {!connection.connected ? <Button disabled={busy === connection.provider} onClick={() => connect(connection.provider)}>
              {busy === connection.provider ? "Redirection…" : `Connecter ${copy.name}`}
            </Button> : <>
              <Button variant="outline" disabled={busy === connection.provider} onClick={() => connect(connection.provider)}>Reconnecter</Button>
              <Button variant="danger" disabled={busy === connection.provider} onClick={() => void disconnect(connection.provider)}>
                {busy === connection.provider ? "Déconnexion…" : `Déconnecter ${copy.name}`}
              </Button>
            </>}
          </div>
        </CardContent>
      </Card>;
    })}
  </div>;
}
