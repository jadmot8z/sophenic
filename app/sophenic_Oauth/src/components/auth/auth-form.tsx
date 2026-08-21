"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/brand/logo";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const submit = async (formData: FormData) => {
    setLoading(true);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));
    const supabase = createClient();
    const result = mode === "login" ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setLoading(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      toast.success("Vérifiez votre email pour confirmer votre compte.");
      return;
    }
    router.replace("/chat");
    router.refresh();
  };
  return <div className="grid min-h-screen place-items-center px-5"><div className="w-full max-w-md"><Link href="/" className="mb-8 block"><Logo /></Link><div className="rounded-3xl border border-zinc-200 bg-white/85 p-7 shadow-2xl shadow-zinc-950/5 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04]"><h1 className="text-2xl font-semibold tracking-tight">{mode === "login" ? "Bienvenue sur Sophenic" : "Créer votre espace Sophenic"}</h1><p className="mt-2 text-sm text-zinc-500">{mode === "login" ? "Retrouvez vos conversations et vos modèles." : "Un seul compte pour tous vos modèles IA."}</p><form action={submit} className="mt-7 space-y-4"><Input name="email" type="email" placeholder="vous@exemple.com" required autoComplete="email" /><Input name="password" type="password" placeholder="Mot de passe" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"} /><Button className="w-full" variant="accent" disabled={loading}>{loading ? "Chargement…" : mode === "login" ? "Se connecter" : "Créer le compte"}</Button></form><p className="mt-5 text-center text-sm text-zinc-500">{mode === "login" ? <>Pas encore de compte ? <Link className="text-indigo-500 hover:underline" href="/signup">S’inscrire</Link></> : <>Déjà inscrit ? <Link className="text-indigo-500 hover:underline" href="/login">Se connecter</Link></>}</p></div></div></div>;
}
