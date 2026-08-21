"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThinkingStepKind =
  | "status"
  | "route"
  | "model"
  | "tool"
  | "file"
  | "command"
  | "test"
  | "fallback";

export type ThinkingStep = {
  id: string;
  label: string;
  detail?: string;
  kind: ThinkingStepKind;
  at: number;
};

export type ThinkingTrace = {
  active: boolean;
  startedAt: number;
  finishedAt?: number;
  steps: ThinkingStep[];
};

export function ThinkingPanel({ trace }: { trace?: ThinkingTrace }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (trace?.active) setOpen(true);
  }, [trace?.active]);

  // Keep only the newest operational summaries. The fixed viewport is bottom
  // anchored, so each new item enters at the bottom and pushes older text up.
  const visibleSteps = useMemo(() => (trace?.steps || []).slice(-6), [trace?.steps]);
  if (!trace || !trace.steps.length) return null;

  return <div className="mb-4 w-full max-w-[760px] text-zinc-500 dark:text-zinc-400">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      className="group flex w-full items-center gap-2 rounded-lg py-1 text-left text-[14px] font-medium transition hover:text-zinc-700 dark:hover:text-zinc-200"
    >
      <BrainCircuit className={cn("size-[18px]", trace.active && "animate-pulse")} />
      <span>{trace.active ? "Thinking..." : "Thinking"}</span>
      {!trace.active && <CheckCircle2 className="size-3.5 text-emerald-600/80 dark:text-emerald-400/80" />}
      <span className="ml-auto grid size-6 place-items-center rounded-md text-zinc-400 transition group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.06]">
        {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </span>
    </button>

    <AnimatePresence initial={false}>
      {open && <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 126 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: .18, ease: "easeOut" }}
        className="relative overflow-hidden"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5 bg-gradient-to-b from-[#f7f7f8] to-transparent dark:from-[#090a0c]" />
        <div className="absolute inset-x-0 bottom-0 flex min-h-full flex-col justify-end gap-1 pb-1 pt-5">
          <div className="px-0.5 pb-1 text-[14px] font-medium text-zinc-500 dark:text-zinc-400">Key parts:</div>
          <AnimatePresence initial={false} mode="popLayout">
            {visibleSteps.map((step, index) => <motion.div
              layout
              key={step.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: .16 }}
              className="flex min-w-0 items-start gap-2 px-0.5 text-[13px] leading-[18px] text-zinc-500 dark:text-zinc-400"
            >
              <span className="w-4 shrink-0 text-right tabular-nums text-zinc-400">{Math.max(1, trace.steps.length - visibleSteps.length + index + 1)}.</span>
              <span className="min-w-0 flex-1 break-words">
                <span className="font-medium text-zinc-500 dark:text-zinc-300">{step.label}</span>
                {step.detail ? <span className="ml-1.5 text-zinc-400">— {step.detail}</span> : null}
              </span>
            </motion.div>)}
          </AnimatePresence>
        </div>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
