import { notFound } from "next/navigation";
import { Users, Bot, Coins, Shield } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatCard } from "@/components/dashboard/stat-card";
import { AdminSyncButton } from "@/components/admin-sync-button";
import { AdminModels, AdminPlans, AdminUsers } from "@/components/admin-controls";
import { formatUsd } from "@/lib/utils";
export const metadata={title:"Administration"};
export default async function AdminPage(){
 const {user,supabase}=await requireUser(); const {data:p}=await supabase.from("profiles").select("role").eq("id",user.id).single(); if(p?.role!=="admin")notFound();
 const admin=createAdminClient(); const [{count:users},{count:models},{data:usage},{data:profiles},{data:plans},{data:modelRows},authUsers]=await Promise.all([admin.from("profiles").select("id",{count:"exact",head:true}),admin.from("models").select("id",{count:"exact",head:true}),admin.from("usage_events").select("cost_usd"),admin.from("profiles").select("id,role,plan_id").order("created_at",{ascending:false}).limit(50),admin.from("plans").select("id,name,daily_token_limit,monthly_token_limit,monthly_cost_limit_usd").order("created_at"),admin.from("models").select("id,name,provider,openrouter_id,enabled,kind").order("sort_order").order("name").limit(60),admin.auth.admin.listUsers({page:1,perPage:50})]);
 const emailMap=new Map(authUsers.data.users.map(u=>[u.id,u.email??u.id])); const rows=(profiles??[]).map(x=>({...x,email:emailMap.get(x.id)??x.id})); const cost=(usage??[]).reduce((a,r)=>a+Number(r.cost_usd??0),0);
 return <div className="mx-auto max-w-6xl p-5 sm:p-8"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-indigo-500">Administration</p><h1 className="text-3xl font-semibold tracking-tight">Sophenic Control</h1></div><AdminSyncButton/></div><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Utilisateurs" value={String(users??0)} icon={Users}/><StatCard label="Modèles" value={String(models??0)} icon={Bot}/><StatCard label="Coût global" value={formatUsd(cost)} icon={Coins}/></div><section className="mt-8"><h2 className="mb-4 text-lg font-semibold">Utilisateurs</h2><AdminUsers initial={rows as never}/></section><section className="mt-8"><h2 className="mb-4 text-lg font-semibold">Modèles disponibles</h2><AdminModels initial={(modelRows??[]) as never}/></section><section className="mt-8"><h2 className="mb-4 text-lg font-semibold">Limites par plan</h2><AdminPlans initial={(plans??[]) as never}/></section><div className="mt-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-5 text-sm"><div className="mb-2 flex items-center gap-2 font-medium"><Shield className="size-4"/>Sécurité</div>Les rôles, plans et limites sont modifiés via des endpoints serveur réservés aux administrateurs. Aucun utilisateur ne peut modifier son propre rôle via RLS.</div></div>;
}
