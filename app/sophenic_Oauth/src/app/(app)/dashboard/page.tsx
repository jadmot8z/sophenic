import Link from "next/link";
import { Coins, Github, MessageSquare, Sparkles, TimerReset, Triangle } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { getRollingUsage } from "@/lib/server/usage";
import { formatCompact, formatUsd } from "@/lib/utils";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const { user, supabase } = await requireUser();
  const [{ count }, usage, { count: conversations }, { data: developerConnections }] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true }),
    getRollingUsage(user.id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("archived", false),
    supabase.from("tool_connections").select("provider,status").eq("user_id", user.id).in("provider", ["github", "vercel"])
  ]);
  const dailyLimit = usage.plan?.daily_token_limit ?? 0;
  const percent = dailyLimit ? (usage.day.tokens / dailyLimit) * 100 : 0;
  const status = new Map((developerConnections ?? []).map((row) => [row.provider, row.status === "connected"]));

  return <div className="mx-auto max-w-6xl p-5 sm:p-8">
    <div className="mb-8"><p className="text-sm font-medium text-indigo-500">Vue d’ensemble</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Votre activité Sophenic</h1><p className="mt-2 text-sm text-zinc-500">Consommation, conversations et budget en un coup d’œil.</p></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Tokens · 24 h" value={formatCompact(usage.day.tokens)} note={dailyLimit ? `sur ${formatCompact(dailyLimit)}` : "limite non définie"} icon={TimerReset}/><StatCard label="Coût · 24 h" value={formatUsd(usage.day.cost)} icon={Coins}/><StatCard label="Conversations" value={String(conversations ?? 0)} icon={MessageSquare}/><StatCard label="Messages" value={String(count ?? 0)} icon={Sparkles}/></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><Card><CardHeader><h2 className="font-medium">Limite glissante · 24 h</h2></CardHeader><CardContent><div className="mb-3 flex justify-between text-sm"><span>{formatCompact(usage.day.tokens)} tokens</span><span className="text-zinc-500">{Math.min(100, percent).toFixed(1)}%</span></div><Progress value={percent}/></CardContent></Card><Card><CardHeader><h2 className="font-medium">Mois en cours</h2></CardHeader><CardContent><div className="grid grid-cols-2 gap-4"><div><div className="text-2xl font-semibold">{formatCompact(usage.month.tokens)}</div><div className="text-xs text-zinc-500">tokens</div></div><div><div className="text-2xl font-semibold">{formatUsd(usage.month.cost)}</div><div className="text-xs text-zinc-500">coût OpenRouter</div></div></div></CardContent></Card></div>

    <Card className="mt-4">
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-medium">Connexions développeur</div><p className="mt-1 text-sm text-zinc-500">Accès direct à GitHub et Vercel depuis Paramètres.</p><div className="mt-3 flex flex-wrap gap-2"><Badge className="gap-1.5"><Github className="size-3"/>GitHub · {status.get("github") ? "Connecté" : "Non connecté"}</Badge><Badge className="gap-1.5"><Triangle className="size-3"/>Vercel · {status.get("vercel") ? "Connecté" : "Non connecté"}</Badge></div></div>
        <Link href="/settings/connections" className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl bg-zinc-950 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">Ouvrir les connexions</Link>
      </CardContent>
    </Card>
  </div>;
}
