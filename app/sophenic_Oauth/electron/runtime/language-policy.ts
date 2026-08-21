export type SophenicLanguage = "fr" | "en" | "es" | "de" | "it" | "pt";

const LANGUAGE_LABELS: Record<SophenicLanguage, string> = {
  fr: "français",
  en: "English",
  es: "español",
  de: "Deutsch",
  it: "italiano",
  pt: "português"
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function detectExplicitLanguage(text: string): SophenicLanguage | null {
  const p = normalize(text);
  const rules: Array<[SophenicLanguage, RegExp]> = [
    ["fr", /\b(?:parle|parler|reponds?|repondre|continue|reste|ecris|ecrire)\b[\s\S]{0,40}\b(?:francais|french)\b|^\s*(?:francais|french)\s*[.!?]*$/],
    ["en", /\b(?:speak|reply|answer|continue|write)\b[\s\S]{0,40}\b(?:english|anglais)\b|^\s*(?:english|anglais)\s*[.!?]*$/],
    ["es", /\b(?:habla|responde|continua|escribe)\b[\s\S]{0,40}\b(?:espanol|spanish)\b|^\s*(?:espanol|spanish)\s*[.!?]*$/],
    ["de", /\b(?:sprich|antworte|schreib)\b[\s\S]{0,40}\b(?:deutsch|german)\b|^\s*(?:deutsch|german)\s*[.!?]*$/],
    ["it", /\b(?:parla|rispondi|scrivi)\b[\s\S]{0,40}\b(?:italiano|italian)\b|^\s*(?:italiano|italian)\s*[.!?]*$/],
    ["pt", /\b(?:fale|responda|escreva)\b[\s\S]{0,40}\b(?:portugues|portuguese)\b|^\s*(?:portugues|portuguese)\s*[.!?]*$/]
  ];
  return rules.find(([, rule]) => rule.test(p))?.[0] || null;
}

function score(text: string, words: RegExp, accent: RegExp): number {
  const normalized = normalize(text);
  const hits = normalized.match(words)?.length || 0;
  return hits + (accent.test(text) ? 2 : 0);
}

export function detectUserLanguage(text: string): SophenicLanguage | null {
  const explicit = detectExplicitLanguage(text);
  if (explicit) return explicit;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const scores: Array<[SophenicLanguage, number]> = [
    ["fr", score(trimmed, /\b(?:salut|bonjour|bonsoir|merci|stp|svp|je|tu|vous|nous|mon|ma|mes|ton|ta|tes|le|la|les|un|une|des|du|de|dans|sur|avec|pour|sans|est|suis|peux|peut|pourrais|comment|quoi|quel|quelle|ouvre|ouvrir|lance|ferme|parle|francais|aide|ordinateur|application)\b/g, /[àâçéèêëîïôùûüÿœ]/i)],
    ["en", score(trimmed, /\b(?:hello|hi|hey|thanks|thank|please|i|you|we|my|your|the|a|an|to|from|with|for|without|is|are|can|could|how|what|which|open|launch|close|speak|english|help|computer|application)\b/g, /\b(?:don't|can't|i'm|you're)\b/i)],
    ["es", score(trimmed, /\b(?:hola|gracias|por favor|yo|tu|usted|mi|el|la|los|las|de|con|para|es|puedes|como|que|abre|abrir|habla|espanol|ayuda)\b/g, /[áéíóúñ¿¡]/i)],
    ["de", score(trimmed, /\b(?:hallo|danke|bitte|ich|du|sie|mein|der|die|das|mit|fur|ist|kannst|wie|was|offne|sprich|deutsch|hilfe)\b/g, /[äöüß]/i)],
    ["it", score(trimmed, /\b(?:ciao|grazie|per favore|io|tu|lei|mio|il|la|con|per|e|puoi|come|cosa|apri|parla|italiano|aiuto)\b/g, /[àèéìòù]/i)],
    ["pt", score(trimmed, /\b(?:ola|obrigado|obrigada|por favor|eu|voce|meu|o|a|com|para|e|pode|como|que|abra|fale|portugues|ajuda)\b/g, /[ãõáéíóúâêôç]/i)]
  ];

  scores.sort((a, b) => b[1] - a[1]);
  if (scores[0][1] <= 0) return null;
  if (scores[0][1] === scores[1][1] && scores[0][1] < 2) return null;
  return scores[0][0];
}

export function languageLabel(language: string | undefined): string {
  return LANGUAGE_LABELS[language as SophenicLanguage] || "la langue de l’utilisateur";
}

export function languagePolicy(language?: string): string {
  const known = LANGUAGE_LABELS[language as SophenicLanguage];
  return known
    ? `Language policy:\n- The user's persistent preferred language is ${known} (${language}).\n- Always answer in ${known}. Keep this persisted language across model/provider changes and fallbacks.\n- Change the persisted conversation language only when the user explicitly asks to use another language. Do not infer a language switch merely from a model name, quoted text, tool output, or a short follow-up.\n- Never switch to English merely because a tool, API, browser, operating-system message, or model error is in English. Translate tool status and explanations into ${known}.`
    : "Language policy:\n- Answer in the language used by the user's latest message.\n- Once a clear language preference is established, keep using it for short or ambiguous follow-up messages.\n- Never switch languages merely because a tool/API/error uses another language.";
}
