import Link from "next/link";
import {
  Bot,
  CircleHelp,
  CreditCard,
  Gauge,
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageSquarePlus,
  MonitorCog,
  Settings,
  Shield,
  Sparkles
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

const primaryNav = [
  ["/agent", "Agent local", MonitorCog, "Local"],
  ["/chat", "Chat cloud", MessageSquarePlus, null],
  ["/history", "Historique", History, null]
] as const;

const productNav = [
  ["/dashboard", "Vue d’ensemble", LayoutDashboard],
  ["/models", "Modèles", Bot],
  ["/usage", "Consommation", Gauge],
  ["/billing", "Facturation", CreditCard]
] as const;

const accountNav = [
  ["/settings", "Paramètres", Settings],
  ["/settings/connections", "Connexions développeur", Link2],
  ["/help", "Aide", CircleHelp]
] as const;

const mobileNav = [
  ["/agent", "Agent", MonitorCog],
  ["/chat", "Chat", MessageSquarePlus],
  ["/history", "Historique", History],
  ["/settings", "Réglages", Settings]
] as const;

function SideLink({ href, label, Icon, badge }: { href: string; label: string; Icon: typeof Bot; badge?: string | null }) {
  return <Link href={href} className="group flex h-9 items-center gap-3 rounded-xl px-2.5 text-[13px] font-medium text-zinc-500 transition hover:bg-zinc-950/[0.045] hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-white/[0.045] dark:hover:text-zinc-200">
    <Icon className="size-[15px] text-zinc-400 transition group-hover:text-zinc-700 dark:text-zinc-600 dark:group-hover:text-zinc-300" />
    <span className="flex-1">{label}</span>
    {badge && <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.12em] text-emerald-600 dark:text-emerald-400">{badge}</span>}
  </Link>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-5 px-2.5 text-[9px] font-semibold uppercase tracking-[.18em] text-zinc-400/80 dark:text-zinc-700">{children}</div>;
}

export async function AppShell({ children, isAdmin = false }: { children: React.ReactNode; isAdmin?: boolean }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <div className="min-h-screen bg-[#f7f7f8] text-zinc-950 dark:bg-[#090a0c] dark:text-zinc-100 lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
    <aside className="hidden min-h-screen border-r border-zinc-200/70 bg-[#fbfbfc] px-3 py-4 dark:border-white/[0.065] dark:bg-[#0c0d10] lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div className="flex h-10 items-center px-2"><Link href="/agent" className="transition opacity-95 hover:opacity-100"><Logo /></Link></div>

      <Link href="/agent" className="mt-4 block">
        <div className="group flex h-10 items-center gap-2.5 rounded-xl border border-zinc-200/80 bg-white px-3 text-[13px] font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:shadow-md dark:border-white/[0.075] dark:bg-white/[0.045] dark:text-zinc-200 dark:shadow-black/20 dark:hover:bg-white/[0.065]">
          <span className="grid size-5 place-items-center rounded-md bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"><Sparkles className="size-3" /></span>
          Nouvelle tâche
          <span className="ml-auto font-mono text-[9px] font-normal text-zinc-400 dark:text-zinc-700">Ctrl N</span>
        </div>
      </Link>

      <nav className="mt-3">
        {primaryNav.map(([href, label, Icon, badge]) => <SideLink key={href} href={href} label={label} Icon={Icon} badge={badge} />)}
        <SectionLabel>Workspace</SectionLabel>
        {productNav.map(([href, label, Icon]) => <SideLink key={href} href={href} label={label} Icon={Icon} />)}
        <SectionLabel>Compte</SectionLabel>
        {accountNav.map(([href, label, Icon]) => <SideLink key={href} href={href} label={label} Icon={Icon} />)}
        {isAdmin && <SideLink href="/admin" label="Administration" Icon={Shield} badge="Admin" />}
      </nav>

      <div className="mt-auto border-t border-zinc-200/70 pt-3 dark:border-white/[0.055]">
        <div className="flex items-center gap-2 rounded-xl px-2 py-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-100 text-xs font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-300/60 dark:from-zinc-800 dark:to-zinc-900 dark:text-zinc-300 dark:ring-white/[0.07]">{user?.email?.slice(0, 1).toUpperCase() || "S"}</div>
          <div className="min-w-0 flex-1"><div className="truncate text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{user?.email}</div><div className="text-[9px] text-zinc-400 dark:text-zinc-700">Sophenic Workspace</div></div>
          <ThemeToggle />
          <form action="/api/auth/signout" method="post"><Button type="submit" variant="ghost" size="icon" className="size-8 rounded-lg text-zinc-400" title="Se déconnecter"><LogOut className="size-3.5" /></Button></form>
        </div>
      </div>
    </aside>

    <div className="min-w-0">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-[#fbfbfc]/90 px-4 backdrop-blur-xl dark:border-white/[0.065] dark:bg-[#0c0d10]/88 lg:hidden">
        <Link href="/agent"><Logo /></Link>
        <div className="flex items-center gap-1"><Link href="/history"><Button variant="ghost" size="icon" className="size-9"><History className="size-4" /></Button></Link><ThemeToggle /></div>
      </header>
      <main className="min-h-screen pb-20 lg:pb-0">{children}</main>
      <nav className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-4 rounded-[18px] border border-zinc-200/80 bg-white/92 p-1.5 shadow-[0_18px_60px_rgba(0,0,0,.14)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#111216]/92 dark:shadow-black/50 lg:hidden">
        {mobileNav.map(([href, label, Icon]) => <Link key={href} href={href} className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[9px] font-medium text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-600 dark:hover:bg-white/[0.05] dark:hover:text-zinc-300"><Icon className="size-4" />{label}</Link>)}
      </nav>
    </div>
  </div>;
}
