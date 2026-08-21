import { requireUser } from "@/lib/auth";
import { HistoryClient } from "@/components/history-client";
export const metadata = { title: "Historique" };
export default async function HistoryPage() {
  const { supabase } = await requireUser();
  const [{ data: conversations }, { data: folders }] = await Promise.all([
    supabase.from("conversations").select("id,title,model_snapshot,archived,updated_at,folder_id").order("updated_at", { ascending: false }),
    supabase.from("folders").select("id,name").order("name")
  ]);
  return <div className="mx-auto max-w-5xl p-5 sm:p-8"><h1 className="text-3xl font-semibold tracking-tight">Historique</h1><p className="mb-8 mt-2 text-sm text-zinc-500">Retrouvez, recherchez, archivez et organisez vos échanges.</p><HistoryClient conversations={(conversations ?? []) as never} folders={(folders ?? []) as never}/></div>;
}
