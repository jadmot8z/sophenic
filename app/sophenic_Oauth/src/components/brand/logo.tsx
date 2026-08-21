import { cn } from "@/lib/utils";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return <div className={cn("flex items-center gap-2.5", className)}>
    <div className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-zinc-950/10 bg-zinc-950 text-white shadow-sm dark:border-white/10 dark:bg-white dark:text-zinc-950">
      <span className="absolute -left-2 top-1 h-px w-8 rotate-[-32deg] bg-current opacity-20" />
      <span className="absolute -right-2 bottom-1 h-px w-8 rotate-[-32deg] bg-current opacity-20" />
      <span className="text-[13px] font-black tracking-[-.08em]">S</span>
    </div>
    {!compact && <span className="text-[15px] font-semibold tracking-[-.025em]">Sophenic</span>}
  </div>;
}
