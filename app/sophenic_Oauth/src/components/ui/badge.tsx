import * as React from "react";
import { cn } from "@/lib/utils";
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300", className)} {...props} />;
}
