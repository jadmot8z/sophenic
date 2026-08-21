import { getUserLanguageMemory } from "../user-language-memory";

const LOCALES: Record<string, string> = { fr: "fr-FR", en: "en-US", es: "es-ES", de: "de-DE", it: "it-IT", pt: "pt-PT" };

function locale(): string { return LOCALES[getUserLanguageMemory() || "fr"] || "fr-FR"; }

export function localSystemTime(): string {
  const value = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  const lang = getUserLanguageMemory() || "fr";
  if (lang === "en") return `The Windows system time is ${value}.`;
  if (lang === "es") return `La hora del sistema Windows es ${value}.`;
  if (lang === "de") return `Die Windows-Systemzeit ist ${value}.`;
  if (lang === "it") return `L'ora di sistema di Windows è ${value}.`;
  if (lang === "pt") return `A hora do sistema Windows é ${value}.`;
  return `L’heure système Windows est ${value}.`;
}

export function localSystemDate(): string {
  const value = new Intl.DateTimeFormat(locale(), { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());
  const lang = getUserLanguageMemory() || "fr";
  if (lang === "en") return `The Windows system date is ${value}.`;
  if (lang === "es") return `La fecha del sistema Windows es ${value}.`;
  if (lang === "de") return `Das Windows-Systemdatum ist ${value}.`;
  if (lang === "it") return `La data di sistema di Windows è ${value}.`;
  if (lang === "pt") return `A data do sistema Windows é ${value}.`;
  return `La date système Windows est ${value}.`;
}
