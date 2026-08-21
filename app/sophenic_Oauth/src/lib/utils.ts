import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: value < 0.01 ? 5 : 2 }).format(value);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function autoTitle(message: string) {
  const cleaned = message.replace(/\s+/g, " ").trim();
  return cleaned.length <= 58 ? cleaned : `${cleaned.slice(0, 55)}…`;
}
