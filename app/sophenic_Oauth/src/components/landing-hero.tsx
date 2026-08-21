"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FolderOpen,
  HardDrive,
  LockKeyhole,
  MonitorCog,
  Send,
  ShieldCheck,
  SquareTerminal,
  WandSparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";

const ease = [0.22, 1, 0.36, 1] as const;

function Status({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/70 px-2.5 py-1 text-[10px] font-medium text-zinc-600 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-400">
    <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.09)]" />{label}
  </span>;
}

function ProductPreview() {
  return <motion.div initial={{ opacity: 0, y: 28, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: .26, duration: .75, ease }} className="relative mx-auto mt-16 max-w-[1080px]">
    <div className="absolute inset-x-[12%] bottom-[-12%] h-36 rounded-full bg-violet-500/10 blur-3xl dark:bg-violet-500/[0.08]" />
    <div className="relative overflow-hidden rounded-[26px] border border-black/[0.08] bg-[#f9f9fa] shadow-[0_35px_110px_rgba(20,20,30,.15)] dark:border-white/[0.08] dark:bg-[#0a0b0e] dark:shadow-[0_45px_140px_rgba(0,0,0,.55)]">
      <div className="flex h-11 items-center border-b border-black/[0.06] bg-white/80 px-4 dark:border-white/[0.06] dark:bg-[#0d0e12]">
        <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" /><span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" /><span className="size-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" /></div>
        <div className="mx-auto -translate-x-6 text-[10px] font-medium tracking-wide text-zinc-400 dark:text-zinc-600">SOPHENIC · LOCAL AGENT</div>
      </div>
      <div className="grid min-h-[510px] grid-cols-[190px_minmax(0,1fr)] sm:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-r border-black/[0.06] bg-[#f4f4f5] p-3 dark:border-white/[0.055] dark:bg-[#0d0e11] sm:block">
          <div className="flex h-9 items-center gap-2.5 rounded-xl bg-zinc-950 px-3 text-[11px] font-semibold text-white shadow-sm dark:bg-white dark:text-zinc-950"><WandSparkles className="size-3.5" />Nouvelle tâche<span className="ml-auto font-mono text-[8px] opacity-40">⌘N</span></div>
          <div className="mt-5 px-2 text-[8px] font-bold uppercase tracking-[.18em] text-zinc-400 dark:text-zinc-700">Aujourd’hui</div>
          {['Refactoriser le projet', 'Analyser les tests', 'Préparer la release'].map((item, i) => <div key={item} className={`mt-1 rounded-lg px-2 py-2 text-[10px] ${i === 0 ? 'bg-white text-zinc-800 shadow-sm dark:bg-white/[0.05] dark:text-zinc-300' : 'text-zinc-500 dark:text-zinc-600'}`}>{item}</div>)}
          <div className="mt-6 px-2 text-[8px] font-bold uppercase tracking-[.18em] text-zinc-400 dark:text-zinc-700">Workspace</div>
          <div className="mt-2 flex items-center gap-2 px-2 text-[10px] text-zinc-500 dark:text-zinc-600"><FolderOpen className="size-3" />C:\Sophenic</div>
          <div className="mt-auto" />
        </aside>

        <section className="min-w-0 bg-white dark:bg-[#090a0d]">
          <div className="flex h-14 items-center gap-2 border-b border-black/[0.055] px-4 dark:border-white/[0.055] sm:px-5">
            <button className="flex min-w-0 items-center gap-2 rounded-xl border border-black/[0.07] bg-zinc-50 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-800 dark:border-white/[0.075] dark:bg-white/[0.035] dark:text-zinc-200"><span className="grid size-5 place-items-center rounded-md bg-zinc-950 text-[8px] font-black text-white dark:bg-white dark:text-zinc-950">Q</span><span className="truncate">Qwen 3.5 · Local</span><ChevronDown className="size-3 text-zinc-400" /></button>
            <span className="hidden items-center gap-1.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400 md:flex"><ShieldCheck className="size-3" />Approvals on</span>
            <div className="ml-auto flex gap-1.5"><Status label="Moteur IA" /><Status label="OpenRouter" /></div>
          </div>

          <div className="mx-auto flex min-h-[455px] max-w-2xl flex-col px-5 py-7 sm:px-8">
            <div className="ml-auto max-w-[80%] rounded-[18px] rounded-br-md bg-zinc-100 px-4 py-3 text-[11px] leading-5 text-zinc-700 dark:bg-white/[0.07] dark:text-zinc-300">Analyse mon projet, lance les tests et propose les corrections. Ne modifie rien sans me demander.</div>
            <div className="mt-7 flex gap-3">
              <div className="grid size-7 shrink-0 place-items-center rounded-lg border border-black/[0.07] bg-white text-[9px] font-black shadow-sm dark:border-white/[0.075] dark:bg-white/[0.04]">S</div>
              <div className="pt-0.5 text-[11px] leading-5 text-zinc-600 dark:text-zinc-400">J’ai inspecté la structure du projet et préparé les tests. Une commande doit être exécutée avant de continuer.</div>
            </div>

            <div className="ml-10 mt-4 overflow-hidden rounded-2xl border border-amber-500/15 bg-amber-500/[0.035]">
              <div className="flex items-center gap-2 border-b border-amber-500/10 px-3.5 py-2.5 text-[9px] font-semibold uppercase tracking-[.13em] text-amber-700 dark:text-amber-300/80"><LockKeyhole className="size-3" />Autorisation requise</div>
              <div className="p-3.5">
                <div className="flex items-center gap-2 text-[9px] text-zinc-400 dark:text-zinc-600"><SquareTerminal className="size-3" />Terminal</div>
                <code className="mt-2 block rounded-lg bg-black/[0.035] px-3 py-2 font-mono text-[10px] text-zinc-700 dark:bg-black/25 dark:text-zinc-300">npm test</code>
                <div className="mt-3 flex justify-end gap-2"><span className="rounded-lg px-2.5 py-1.5 text-[9px] text-zinc-500">Refuser</span><span className="inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[9px] font-medium text-white dark:bg-white dark:text-zinc-950"><Check className="size-2.5" />Autoriser une fois</span></div>
              </div>
            </div>

            <div className="mt-auto rounded-[18px] border border-black/[0.08] bg-zinc-50 p-2 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.035]">
              <div className="min-h-9 px-2 py-1.5 text-[10px] text-zinc-400 dark:text-zinc-600">Demandez à Sophenic d’agir sur votre projet…</div>
              <div className="flex items-center px-1"><div className="flex items-center gap-1.5 text-[8px] text-zinc-400 dark:text-zinc-700"><LockKeyhole className="size-2.5" />Actions contrôlées</div><span className="ml-auto grid size-7 place-items-center rounded-lg bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"><Send className="size-3" /></span></div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </motion.div>;
}

export function LandingHero() {
  return <main className="relative overflow-hidden px-5 pb-28 pt-28 sm:pt-36">
    <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[540px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,.08),transparent_63%)] dark:bg-[radial-gradient(circle,rgba(139,92,246,.08),transparent_65%)]" />
    <div className="mx-auto max-w-6xl">
      <div className="text-center">
        <motion.div initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, ease }} className="mx-auto inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/75 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-zinc-400"><MonitorCog className="size-3.5" />AI agent · Windows · Local-first</motion.div>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .07, duration: .65, ease }} className="mx-auto mt-7 max-w-[950px] text-balance text-[44px] font-semibold leading-[.98] tracking-[-.055em] text-zinc-950 dark:text-white sm:text-7xl lg:text-[82px]">Une IA qui ne se contente pas de répondre. <span className="text-zinc-400 dark:text-zinc-600">Elle agit.</span></motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .14, duration: .65 }} className="mx-auto mt-7 max-w-2xl text-balance text-[15px] leading-7 text-zinc-500 dark:text-zinc-500 sm:text-base">Sophenic réunit une interface de conversation simple, un choix de modèles OpenRouter et des outils intégrés. Vos réglages restent sous votre contrôle, et chaque action sensible demande votre autorisation.</motion.p>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2, duration: .6, ease }} className="mt-8 flex flex-wrap justify-center gap-2.5"><Link href="/signup"><Button size="lg" className="h-11 rounded-xl bg-zinc-950 px-5 text-sm text-white shadow-lg shadow-black/10 hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">Créer mon espace <ArrowRight className="size-3.5" /></Button></Link><Link href="/login"><Button size="lg" variant="outline" className="h-11 rounded-xl px-5 text-sm">Se connecter</Button></Link></motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .3 }} className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[10px] font-medium text-zinc-400 dark:text-zinc-600"><span className="flex items-center gap-1.5"><HardDrive className="size-3" />Modèles OpenRouter</span><span className="flex items-center gap-1.5"><ShieldCheck className="size-3" />Permissions explicites</span><span className="flex items-center gap-1.5"><SquareTerminal className="size-3" />Outils intégrés</span></motion.div>
      </div>

      <ProductPreview />

      <div className="mx-auto mt-20 grid max-w-5xl gap-px overflow-hidden rounded-[22px] border border-black/[0.07] bg-black/[0.06] dark:border-white/[0.07] dark:bg-white/[0.06] md:grid-cols-3">
        {[{icon:HardDrive,title:'Model choice',copy:'Choisissez le modèle OpenRouter qui convient à chaque conversation et retrouvez le même réglage global depuis PowerShell.'},{icon:ShieldCheck,title:'Permission first',copy:'Les actions sensibles restent derrière des approbations visibles pour que vous gardiez le contrôle.'},{icon:FolderOpen,title:'Workspace aware',copy:'Choisissez explicitement le projet sur lequel l’agent peut travailler, session par session.'}].map(({icon:Icon,title,copy}) => <div key={title} className="bg-white p-6 dark:bg-[#0c0d10]"><div className="grid size-9 place-items-center rounded-xl border border-black/[0.06] bg-zinc-50 dark:border-white/[0.065] dark:bg-white/[0.035]"><Icon className="size-4 text-zinc-600 dark:text-zinc-400" /></div><h3 className="mt-7 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-200">{title}</h3><p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-600">{copy}</p></div>)}
      </div>
    </div>
  </main>;
}
