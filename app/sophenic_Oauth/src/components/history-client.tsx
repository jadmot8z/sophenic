"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Folder, FolderPlus, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Conversation = { id: string; title: string; model_snapshot: string | null; archived: boolean; updated_at: string; folder_id: string | null };
type FolderRow = { id: string; name: string };
export function HistoryClient({ conversations, folders }: { conversations: Conversation[]; folders: FolderRow[] }) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState(conversations); const [folderRows,setFolderRows]=useState(folders);
  const filtered = useMemo(() => rows.filter(c => c.archived === showArchived && c.title.toLowerCase().includes(query.toLowerCase())), [rows, query, showArchived]);
  const mutate = async (id: string, action: "archive" | "delete") => {
    const res = await fetch(`/api/conversations/${id}${action === "archive" ? "/archive" : ""}`, { method: action === "archive" ? "POST" : "DELETE" });
    if (!res.ok) return toast.error("Action impossible");
    if (action === "delete") setRows(r => r.filter(x => x.id !== id)); else setRows(r => r.map(x => x.id === id ? { ...x, archived: !x.archived } : x));
  };
  const createFolder=async()=>{const name=window.prompt("Nom du dossier");if(!name)return;const r=await fetch("/api/folders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name})});const j=await r.json();if(r.ok)setFolderRows(f=>[...f,j]);else toast.error(j.error??"Impossible de créer le dossier");};
  const move=async(id:string,folderId:string)=>{const value=folderId||null;const r=await fetch(`/api/conversations/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({folderId:value})});if(r.ok)setRows(x=>x.map(c=>c.id===id?{...c,folder_id:value}:c));else toast.error("Déplacement impossible");};
  const rename=async(id:string,title:string)=>{const next=window.prompt("Nouveau titre",title)?.trim();if(!next||next===title)return;const r=await fetch(`/api/conversations/${id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({title:next})});if(r.ok)setRows(x=>x.map(c=>c.id===id?{...c,title:next}:c));else toast.error("Renommage impossible");};
  return <div><div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-3.5 size-4 text-zinc-400"/><Input className="pl-9" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher une conversation…" /></div><Button variant="outline" onClick={createFolder}><FolderPlus className="size-4"/>Dossier</Button><Button variant="outline" onClick={()=>setShowArchived(v=>!v)}><Archive className="size-4"/>{showArchived ? "Actives" : "Archives"}</Button></div><div className="mb-6 flex flex-wrap gap-2">{folderRows.map(f=><Badge key={f.id}><Folder className="mr-1 size-3"/>{f.name}</Badge>)}</div><div className="space-y-2">{filtered.map(c=><div key={c.id} className="group flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.03]"><Link href={`/chat/${c.id}`} className="min-w-0 flex-1"><div className="truncate font-medium">{c.title}</div><div className="mt-1 flex gap-2 text-xs text-zinc-500"><span>{c.model_snapshot ?? "Modèle automatique"}</span><span>·</span><span>{new Date(c.updated_at).toLocaleDateString("fr-FR")}</span></div></Link><select aria-label="Dossier" className="hidden max-w-32 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-500 dark:border-white/10 sm:block" value={c.folder_id??""} onChange={e=>move(c.id,e.target.value)}><option value="">Sans dossier</option>{folderRows.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select><Button variant="ghost" size="icon" onClick={()=>rename(c.id,c.title)}><Pencil className="size-4"/></Button><Button variant="ghost" size="icon" onClick={()=>mutate(c.id,"archive")}><Archive className="size-4"/></Button><Button variant="ghost" size="icon" onClick={()=>mutate(c.id,"delete")}><Trash2 className="size-4"/></Button></div>)}{filtered.length===0&&<div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-white/10">Aucune conversation.</div>}</div></div>;
}
