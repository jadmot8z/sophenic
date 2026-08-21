"use client";
import { MarkdownMathRenderer } from "@/components/MarkdownMathRenderer";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";

export type ChatMessage = { id: string; role: "user"|"assistant"|"system"; content: string; model_snapshot?: string|null; total_tokens?: number|null; cost_usd?: number|string|null; metadata?: Record<string,unknown>|null; pending?: boolean };
export function MessageBubble({message}:{message:ChatMessage}){
  if(message.role==="system")return null;
  const imageId=typeof message.metadata?.attachment_id==="string"?message.metadata.attachment_id:null;
  return <div className={`flex gap-3 py-5 ${message.role==="user"?"justify-end":""}`}>
    {message.role==="assistant"&&<div className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white"><Bot className="size-4"/></div>}
    <div className={`min-w-0 max-w-[88%] ${message.role==="user"?"rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-white/8":"flex-1"}`}>
      {imageId&&<img src={`/api/media/${imageId}`} alt="Image générée par Sophenic" className="mb-3 max-h-[640px] rounded-2xl border border-zinc-200 object-contain dark:border-white/10"/>}
      <div className="prose-sophenic text-sm leading-7"><MarkdownMathRenderer content={message.content|| (message.pending?"▍":"")} /></div>
      {message.role==="assistant"&&<div className="mt-3 flex flex-wrap items-center gap-2">{message.model_snapshot&&<Badge>{message.model_snapshot}</Badge>}{typeof message.total_tokens==="number"&&<span className="text-[11px] text-zinc-500">{message.total_tokens.toLocaleString("fr-FR")} tokens</span>}{message.cost_usd!=null&&<span className="text-[11px] text-zinc-500">{formatUsd(Number(message.cost_usd))}</span>}</div>}
    </div>
    {message.role==="user"&&<div className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl border border-zinc-200 dark:border-white/10"><User className="size-4"/></div>}
  </div>
}
