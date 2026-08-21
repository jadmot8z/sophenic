"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ProviderStatus = {
  id: string;
  name: string;
  role: string;
  keyCount: number;
  accountCount?: number;
  configured: boolean;
  requiresAccountId: boolean;
  accountIdConfigured: boolean;
  baseUrlConfigured: boolean;
  docsUrl: string;
  keyUrl: string;
  models: Array<{ id: string; name: string; context?: number }>;
};

type VaultInfo = {
  encrypted: boolean;
  path: string;
  providerCount: number;
  maxKeysPerProvider: number;
};

function humanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Erreur inconnue");
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error|TypeError):\s*/i, "").replace(/^(?:Error|TypeError):\s*/i, "");
}

export function ProviderSettingsModal({ onClose, onChanged }: { onClose: () => void; onChanged?: (providerCount: number) => void }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [activeId, setActiveId] = useState("");
  const [keysText, setKeysText] = useState("");
  const [accountId, setAccountId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const active = useMemo(() => providers.find((item) => item.id === activeId) || providers[0], [activeId, providers]);

  const refresh = async () => {
    const desktop = window.sophenicDesktop;
    if (!desktop) return;
    setBusy("refresh");
    try {
      const result = await desktop.runtime.providerStatus();
      setProviders(result.providers as ProviderStatus[]);
      setVault(result.vault as VaultInfo);
      setActiveId((current) => current || result.providers[0]?.id || "");
      setError("");
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => { void refresh(); }, []);

  const save = async () => {
    const desktop = window.sophenicDesktop;
    if (!desktop || !active) return;
    const keys = keysText.split(/[\n,;]+/g).map((value) => value.trim()).filter(Boolean);
    if (!keys.length && !accountId.trim() && !baseUrl.trim()) {
      setError("Ajoute au moins une clé API, un Account ID Cloudflare ou une URL régionale.");
      return;
    }
    setBusy("save"); setError(""); setSaved("");
    try {
      const result = await desktop.runtime.saveProvider({
        provider: active.id,
        keys,
        ...(accountId.trim() ? { accountId: accountId.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        mode: "append"
      });
      setProviders(result.providers as ProviderStatus[]);
      setVault(result.vault as VaultInfo);
      setKeysText(""); setAccountId(""); setBaseUrl("");
      setSaved(`${active.name} enregistré dans le coffre Sophenic.`);
      onChanged?.(result.vault.providerCount);
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy("");
    }
  };

  const importFile = async () => {
    const desktop = window.sophenicDesktop;
    if (!desktop) return;
    setBusy("import"); setError(""); setSaved("");
    try {
      const result = await desktop.runtime.importProviderFile();
      if (result.canceled) return;
      if (result.providers) setProviders(result.providers as ProviderStatus[]);
      if (result.vault) {
        setVault(result.vault as VaultInfo);
        onChanged?.(result.vault.providerCount);
      }
      const summary = (result.summaries || []).map((item) =>
        `${item.name}: ${item.imported}${item.accountCount ? ` (${item.accountCount} compte(s))` : ""}`
      ).join(" · ");
      const warnings = (result.warnings || []).join(" ");
      setSaved(`Import chiffré terminé${result.fileName ? ` depuis ${result.fileName}` : ""}. ${summary}${warnings ? ` — ${warnings}` : ""} Supprime ensuite le fichier TXT en clair.`);
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy("");
    }
  };

  const clear = async () => {
    const desktop = window.sophenicDesktop;
    if (!desktop || !active) return;
    if (!window.confirm(`Supprimer toutes les clés ${active.name} enregistrées dans Sophenic ?`)) return;
    setBusy("clear"); setError(""); setSaved("");
    try {
      const result = await desktop.runtime.clearProvider(active.id);
      setProviders(result.providers as ProviderStatus[]);
      setVault(result.vault as VaultInfo);
      setSaved(`${active.name} supprimé du coffre.`);
      onChanged?.(result.vault.providerCount);
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy("");
    }
  };

  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[130] grid place-items-center bg-black/45 p-4 backdrop-blur-sm">
    <motion.div initial={{ y: 16, scale: 0.985 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, opacity: 0 }} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-[#d8c29b] bg-[#fffdf8] shadow-2xl dark:border-white/10 dark:bg-[#24211d]">
      <div className="flex items-start gap-3 border-b border-[#eadcc4] p-5 dark:border-white/10">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#f2e2c7] text-[#795827]"><KeyRound className="size-5" /></div>
        <div className="min-w-0 flex-1"><h2 className="font-semibold">Fournisseurs IA Sophenic</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Ajoute tes propres clés ici. Sophenic choisit ensuite automatiquement Provider → Modèle → Clé et bascule quand une clé atteint un quota ou un cooldown.</p></div>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-xl text-zinc-400 hover:bg-black/5 dark:hover:bg-white/5"><X className="size-4" /></button>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[300px_1fr]">
        <aside className="min-h-0 overflow-y-auto border-b border-[#eadcc4] p-3 md:border-b-0 md:border-r dark:border-white/10">
          <div className="mb-2 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#9a7138]"><span>{vault?.providerCount || 0} connecté(s)</span><button type="button" onClick={() => void refresh()} title="Actualiser"><RefreshCw className={cn("size-3.5", busy === "refresh" && "animate-spin")} /></button></div>
          <div className="space-y-1">{providers.map((item) => <button key={item.id} type="button" onClick={() => { setActiveId(item.id); setError(""); setSaved(""); setKeysText(""); setAccountId(""); setBaseUrl(""); }} className={cn("w-full rounded-2xl px-3 py-2.5 text-left transition", active?.id === item.id ? "bg-[#f0e1c9] dark:bg-white/[0.08]" : "hover:bg-[#f7eedf] dark:hover:bg-white/[0.04]")}><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", item.configured ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600")} /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>{item.keyCount > 0 && <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[9px] tabular-nums dark:bg-black/20">{item.keyCount}</span>}</div><div className="mt-1 line-clamp-2 pl-4 text-[10px] leading-4 text-zinc-500">{item.role}</div></button>)}</div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-5">
          {!active ? <div className="grid min-h-52 place-items-center text-sm text-zinc-400"><Loader2 className="size-5 animate-spin" /></div> : <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold">{active.name}</h3>{active.configured && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">PRÊT</span>}</div><p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">{active.role}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void importFile()}>{busy === "import" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}Importer TXT</Button><Button variant="outline" size="sm" onClick={() => void window.sophenicDesktop?.runtime.openProviderUrl(active.id, "docs")}><ExternalLink className="size-3.5" />Docs</Button><Button variant="outline" size="sm" onClick={() => void window.sophenicDesktop?.runtime.openProviderUrl(active.id, "key")}><KeyRound className="size-3.5" />Obtenir une clé</Button></div></div>

            <div className="mt-5 rounded-2xl border border-[#e6d6bb] bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.025]"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-emerald-600" />Coffre de clés</div><p className="mt-1 text-[10px] leading-4 text-zinc-500">{vault?.encrypted ? "Chiffrement Electron/Windows disponible. Les clés stockées ne sont jamais réaffichées." : "Le chiffrement sécurisé n’est pas disponible sur cette session : Sophenic refusera d’enregistrer des secrets en clair."}</p><textarea value={keysText} onChange={(event) => setKeysText(event.target.value)} placeholder={`Colle ici 1 à ${vault?.maxKeysPerProvider || 20} clé(s) ${active.name}, une par ligne`} rows={4} className="mt-3 w-full resize-y rounded-xl border border-[#d9c39e] bg-[#fffaf0] px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-[#c69a52]/30 dark:border-white/10 dark:bg-black/20" /><div className="mt-1 text-[9px] text-zinc-400">Déjà enregistrées : {active.keyCount} clé(s){active.requiresAccountId && active.accountCount ? ` · ${active.accountCount} compte(s) Cloudflare` : ""}. Un nouvel enregistrement ajoute les nouvelles clés sans afficher les anciennes.</div></div>

            {active.requiresAccountId && <div className="mt-4"><label className="text-xs font-semibold">Cloudflare Account ID</label><Input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder={active.accountIdConfigured ? "Déjà configuré — laisse vide pour conserver" : "Account ID Cloudflare"} className="mt-2" /><p className="mt-1 text-[9px] text-zinc-400">Le token API seul ne suffit pas pour construire l’URL Workers AI.</p></div>}

            {active.id === "scaleway" && <div className="mt-4 rounded-2xl border border-[#e6d6bb] bg-[#fffaf0] p-3 text-[10px] leading-5 text-zinc-500 dark:border-white/10 dark:bg-white/[0.025]"><b className="text-zinc-700 dark:text-zinc-200">Scaleway Generative APIs</b><br />Colle la <b>Secret Key</b> dans le coffre ci-dessus. L’Access Key ID commençant par <code>SCW…</code> n’est pas une URL. Sophenic utilise automatiquement l’endpoint Generative APIs officiel.</div>}

            {(active.id === "alibaba" || (active.baseUrlConfigured && active.id !== "scaleway")) && <div className="mt-4"><label className="text-xs font-semibold">URL API régionale (optionnel)</label><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={active.baseUrlConfigured ? "Déjà configurée — laisse vide pour conserver" : "https://…/v1"} className="mt-2 font-mono text-xs" /><p className="mt-1 text-[9px] text-zinc-400">Utilise uniquement une URL HTTPS officielle correspondant à ta région/ton workspace.</p></div>}

            <div className="mt-5"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#9a7138]">Modèles connus du routeur</div><div className="mt-2 flex flex-wrap gap-1.5">{active.models.map((item) => <span key={item.id} title={item.id} className="max-w-full truncate rounded-full bg-[#f3e7d4] px-2.5 py-1 text-[10px] text-[#735735] dark:bg-white/[0.06] dark:text-zinc-300">{item.name}</span>)}</div></div>

            {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</div>}
            {saved && <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"><Check className="size-4" />{saved}</div>}

            <div className="mt-5 flex flex-wrap justify-between gap-2"><Button variant="danger" disabled={!active.keyCount || Boolean(busy)} onClick={() => void clear()}><Trash2 className="size-4" />Supprimer {active.name}</Button><Button disabled={Boolean(busy)} className="bg-[#5f4a2e] text-white" onClick={() => void save()}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}Enregistrer dans le coffre</Button></div>
          </>}
        </section>
      </div>
      <div className="border-t border-[#eadcc4] px-5 py-3 text-[9px] leading-4 text-zinc-400 dark:border-white/10">Les clés restent sur cet ordinateur et ne sont pas intégrées au ZIP/EXE. « Importer TXT » chiffre le contenu dans le coffre Electron/Windows ; supprime ensuite le fichier texte original. Pour une version publique de Sophenic, les clés globales devront être déplacées vers un backend/secret vault.</div>
    </motion.div>
  </motion.div>;
}
