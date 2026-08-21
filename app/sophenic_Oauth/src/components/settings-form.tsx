"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function SettingsForm({ initial }: { initial: { display_name?: string | null; locale?: string | null; custom_system_prompt?: string | null } }) {
  const [loading,setLoading]=useState(false);
  async function submit(formData: FormData){ setLoading(true); const res=await fetch("/api/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({displayName:formData.get("displayName"),locale:formData.get("locale"),systemPrompt:formData.get("systemPrompt")})}); setLoading(false); res.ok?toast.success("Paramètres enregistrés"):toast.error("Impossible d’enregistrer"); }
  return <form action={submit} className="max-w-2xl space-y-5"><div><label className="mb-2 block text-sm font-medium">Nom affiché</label><Input name="displayName" defaultValue={initial.display_name??""}/></div><div><label className="mb-2 block text-sm font-medium">Langue</label><Input name="locale" defaultValue={initial.locale??"fr"}/></div><div><label className="mb-2 block text-sm font-medium">Instruction système personnelle</label><Textarea name="systemPrompt" defaultValue={initial.custom_system_prompt??""} placeholder="Ex. Réponds de façon concise et structurée."/><p className="mt-2 text-xs text-zinc-500">Cette instruction est ajoutée côté serveur avant vos messages.</p></div><Button variant="accent" disabled={loading}>{loading?"Enregistrement…":"Enregistrer"}</Button></form>;
}
