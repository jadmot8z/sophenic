import type { BrowserWindow } from "electron";
import { killApplication, launchApplication, openWebTarget, type KnownApplication } from "./actions/applications";
import { chooseAndOpenFile, createDesktopDirectory, createDesktopFile, openKnownFolder } from "./actions/filesystem";
import { spotify } from "./actions/spotify-controller";
import { localSystemDate, localSystemTime } from "./actions/system-clock";
import { changeWindowsVolume, getWindowsVolume, setWindowsMute, setWindowsVolume } from "./actions/windows-audio";
import { routedActionCapability, tryAppendAgentAudit } from "./agent-governance";

export type RoutedActionResult = { handled: true; ok: boolean; kind: string; message: string; target?: string; verified?: boolean };

const KNOWN_APPS = new Set<KnownApplication>(["notepad", "calculator", "spotify", "whatsapp", "chrome", "discord", "edge", "firefox"]);
const ALLOWED_KINDS = new Set([
  "application.launch", "application.kill", "web.open", "spotify.search_play", "spotify.pause", "spotify.resume", "spotify.next", "spotify.previous",
  "audio.get_volume", "audio.set_volume", "audio.change_volume", "audio.set_mute", "system.time", "system.date",
  "filesystem.open_known_folder", "filesystem.choose_open_file", "filesystem.create_directory", "filesystem.create_file"
]);

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Action locale invalide.");
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 180): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

function finiteNumber(value: unknown, min: number, max: number, label: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} invalide.`);
  return parsed;
}

export async function executeRoutedAction(value: unknown, owner?: BrowserWindow | null): Promise<RoutedActionResult> {
  const action = row(value);
  const kind = text(action.kind, 80);
  if (!ALLOWED_KINDS.has(kind)) throw new Error("Action locale non autorisée.");
  const capability = routedActionCapability(kind);
  if (capability) tryAppendAgentAudit({ capability, action: kind, risk: kind.includes("kill") || kind.includes("create_") ? "sensitive" : "write", outcome: "requested" });

  if (kind === "application.launch" || kind === "application.kill") {
    const app = text(action.app, 40) as KnownApplication;
    if (!KNOWN_APPS.has(app)) throw new Error("Application non autorisée.");
    const result = kind === "application.launch" ? await launchApplication(app) : await killApplication(app);
    return { handled: true, kind, ...result };
  }

  if (kind === "web.open") {
    if (action.target !== "youtube" || action.url !== "https://www.youtube.com/") throw new Error("Cible Web non autorisée.");
    const result = await openWebTarget("https://www.youtube.com/", "YouTube");
    return { handled: true, kind, ...result };
  }

  if (kind === "spotify.search_play") {
    const result = await spotify.search(text(action.query, 180));
    return { handled: true, kind, ...result };
  }
  if (kind === "spotify.pause") return { handled: true, kind, ...(await spotify.pause()) };
  if (kind === "spotify.resume") return { handled: true, kind, ...(await spotify.play()) };
  if (kind === "spotify.next") return { handled: true, kind, ...(await spotify.next()) };
  if (kind === "spotify.previous") return { handled: true, kind, ...(await spotify.previous()) };

  if (kind === "audio.get_volume") return { handled: true, kind, ...getWindowsVolume() };
  if (kind === "audio.set_volume") return { handled: true, kind, ...setWindowsVolume(finiteNumber(action.level, 0, 100, "Volume")) };
  if (kind === "audio.change_volume") return { handled: true, kind, ...changeWindowsVolume(finiteNumber(action.delta, -100, 100, "Variation de volume")) };
  if (kind === "audio.set_mute") {
    if (typeof action.muted !== "boolean") throw new Error("État muet invalide.");
    return { handled: true, kind, ...setWindowsMute(action.muted) };
  }

  if (kind === "system.time") return { handled: true, ok: true, kind, verified: true, message: localSystemTime() };
  if (kind === "system.date") return { handled: true, ok: true, kind, verified: true, message: localSystemDate() };

  if (kind === "filesystem.open_known_folder") {
    const folder = action.folder === "downloads" ? "downloads" : action.folder === "desktop" ? "desktop" : null;
    if (!folder) throw new Error("Dossier système non autorisé.");
    return { handled: true, kind, ...(await openKnownFolder(folder)) };
  }
  if (kind === "filesystem.choose_open_file") return { handled: true, kind, ...(await chooseAndOpenFile(owner)) };
  if (kind === "filesystem.create_directory") return { handled: true, kind, ...createDesktopDirectory(text(action.name, 120)) };
  if (kind === "filesystem.create_file") return { handled: true, kind, ...createDesktopFile(text(action.name, 120)) };

  throw new Error("Action locale non prise en charge.");
}
