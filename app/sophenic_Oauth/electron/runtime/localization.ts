import type { SophenicLanguage } from "./language-policy";
import { getUserLanguageMemory } from "./user-language-memory";

export type LocalizedText = { fr: string; en: string; es?: string; de?: string; it?: string; pt?: string };

export function localText(text: LocalizedText, fallbackLanguage: SophenicLanguage = "fr"): string {
  const language = getUserLanguageMemory() || fallbackLanguage;
  return text[language] || text.en || text.fr;
}
