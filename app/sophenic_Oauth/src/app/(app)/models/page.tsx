import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
export const metadata = { title: "Modèles IA" };
export default async function ModelsPage() {
  const { supabase } = await requireUser();
  const { data: models } = await supabase.from("models").select("id,name,provider,kind,context_length,enabled,openrouter_id").eq("enabled", true).order("provider").order("name");
  return <div className="mx-auto max-w-6xl p-5 sm:p-8"><h1 className="text-3xl font-semibold tracking-tight">Modèles IA</h1><p className="mb-8 mt-2 text-sm text-zinc-500">Le catalogue est synchronisable depuis OpenRouter par un administrateur.</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(models ?? []).map(m=><Card key={m.id}><CardContent><div className="mb-6 flex items-start justify-between"><div><div className="font-medium">{m.name}</div><div className="mt-1 text-xs text-zinc-500">{m.openrouter_id}</div></div><Badge>{m.kind}</Badge></div><div className="flex justify-between text-xs text-zinc-500"><span>{m.provider}</span><span>{m.context_length ? `${Number(m.context_length).toLocaleString("fr-FR")} ctx` : "contexte variable"}</span></div></CardContent></Card>)}</div></div>;
}
