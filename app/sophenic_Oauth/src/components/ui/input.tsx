import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-11 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-white/10 dark:bg-white/5", className)} {...props} />;
}
