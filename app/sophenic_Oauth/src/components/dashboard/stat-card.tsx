import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
export function StatCard({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon: LucideIcon }) {
  return <Card><CardContent><div className="mb-8 flex items-center justify-between"><span className="text-sm text-zinc-500">{label}</span><Icon className="size-4 text-indigo-500" /></div><div className="text-2xl font-semibold tracking-tight">{value}</div>{note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}</CardContent></Card>;
}
