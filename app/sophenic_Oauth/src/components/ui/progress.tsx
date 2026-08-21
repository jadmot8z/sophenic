export function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
