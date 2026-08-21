"use client";
import { Badge } from "@/components/ui/badge";
export type ModelOption={id:string;name:string;provider:string;kind:string;openrouter_id:string};
export function ModelSelector({models,value,onChange,kind="text"}:{models:ModelOption[];value:string;onChange:(id:string)=>void;kind?:"text"|"image"}){const visible=models.filter(m=>kind==="image"?m.kind==="image":m.kind!=="image");return <div className="flex items-center gap-2"><select value={value} onChange={e=>onChange(e.target.value)} className="max-w-[260px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none dark:border-white/10 dark:bg-zinc-900">{visible.map(m=><option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}</select><Badge className="hidden sm:inline-flex">{kind}</Badge></div>}
