import { requireUser } from "@/lib/auth";
import { formatCompact, formatUsd } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
export const metadata = { title: "Consommation" };
export default async function UsagePage() {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("usage_events").select("id,provider_model,usage_kind,prompt_tokens,completion_tokens,total_tokens,cost_usd,created_at").order("created_at", { ascending: false }).limit(100);
  const byModel = new Map<string,{tokens:number,cost:number}>();
  for (const r of data ?? []) { const k=r.provider_model; const v=byModel.get(k)??{tokens:0,cost:0}; v.tokens+=Number(r.total_tokens??0); v.cost+=Number(r.cost_usd??0); byModel.set(k,v); }
  return <div className="mx-auto max-w-6xl p-5 sm:p-8"><h1 className="text-3xl font-semibold tracking-tight">Consommation</h1><p className="mb-8 mt-2 text-sm text-zinc-500">Détail des 100 dernières générations et ventilation par modèle.</p><div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...byModel.entries()].slice(0,6).map(([model,v])=><Card key={model}><CardContent><div className="truncate text-sm font-medium">{model}</div><div className="mt-5 flex justify-between"><span className="text-xl font-semibold">{formatCompact(v.tokens)}</span><span className="text-sm text-zinc-500">{formatUsd(v.cost)}</span></div></CardContent></Card>)}</div><div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-zinc-100/80 text-xs text-zinc-500 dark:bg-white/5"><tr><th className="p-3">Date</th><th>Modèle</th><th>Type</th><th>Tokens</th><th>Coût</th></tr></thead><tbody>{(data??[]).map(r=><tr key={r.id} className="border-t border-zinc-200 dark:border-white/10"><td className="p-3 text-zinc-500">{new Date(r.created_at).toLocaleString("fr-FR")}</td><td className="max-w-64 truncate pr-4">{r.provider_model}</td><td>{r.usage_kind}</td><td>{formatCompact(Number(r.total_tokens??0))}</td><td>{formatUsd(Number(r.cost_usd??0))}</td></tr>)}</tbody></table></div></div></div>;
}
