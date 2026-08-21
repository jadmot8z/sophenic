import Link from "next/link";
import { Link2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { SettingsForm } from "@/components/settings-form";
import { Card, CardContent } from "@/components/ui/card";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const { user, supabase } = await requireUser();
  const { data } = await supabase.from("user_settings")
    .select("display_name,locale,custom_system_prompt")
    .eq("user_id", user.id)
    .maybeSingle();

  return <div className="mx-auto max-w-5xl p-5 sm:p-8">
    <h1 className="text-3xl font-semibold tracking-tight">Paramètres</h1>
    <p className="mt-2 text-sm text-zinc-500">Personnalisez votre expérience Sophenic.</p>

    <Card className="my-7 max-w-2xl">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"><Link2 className="size-4" /></div>
          <div><div className="font-medium">Connexions développeur</div><p className="mt-1 text-sm leading-6 text-zinc-500">Connectez GitHub et Vercel avec OAuth, sans coller de token dans un formulaire.</p></div>
        </div>
        <Link href="/settings/connections" className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10">Gérer les connexions</Link>
      </CardContent>
    </Card>

    <SettingsForm initial={data ?? {}} />
  </div>;
}
