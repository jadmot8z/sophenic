import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectExplicitLanguage, detectUserLanguage, type SophenicLanguage } from "./language-policy";

type SettingsRecord = Record<string, unknown> & { preferredLanguage?: SophenicLanguage; languagePreferenceLocked?: boolean };

function dataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}

function settingsPath(): string { return path.join(dataHome(), "settings.json"); }

function readSettings(): SettingsRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as SettingsRecord : {};
  } catch {
    return {};
  }
}

function writeLanguage(language: SophenicLanguage, locked?: boolean): void {
  const target = settingsPath();
  const current = readSettings();
  const next = { ...current, preferredLanguage: language, ...(locked === undefined ? {} : { languagePreferenceLocked: locked }) };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

export const userLanguageMemory = {
  get(): SophenicLanguage | undefined {
    const value = readSettings().preferredLanguage;
    return value === "fr" || value === "en" || value === "es" || value === "de" || value === "it" || value === "pt" ? value : undefined;
  },

  set(language: SophenicLanguage, locked = true): SophenicLanguage {
    writeLanguage(language, locked);
    return language;
  },

  remember(userText: string): SophenicLanguage | undefined {
    const current = readSettings();
    const explicit = detectExplicitLanguage(userText);
    if (explicit) {
      if (current.preferredLanguage !== explicit || current.languagePreferenceLocked !== true) writeLanguage(explicit, true);
      return explicit;
    }
    if (current.languagePreferenceLocked === true && current.preferredLanguage) return current.preferredLanguage;
    const detected = detectUserLanguage(userText);
    if (!detected) return this.get();
    if (current.preferredLanguage !== detected) writeLanguage(detected, false);
    return detected;
  }
};

export function getUserLanguageMemory(): SophenicLanguage | undefined { return userLanguageMemory.get(); }
export function rememberUserLanguageMemory(userText: string): SophenicLanguage | undefined { return userLanguageMemory.remember(userText); }
