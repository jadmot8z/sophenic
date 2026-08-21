import { shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { localText } from "../localization";

export type KnownApplication = "notepad" | "calculator" | "spotify" | "whatsapp" | "chrome" | "discord" | "edge" | "firefox";

export type ApplicationActionResult = { ok: boolean; message: string; target: string; verified: boolean };

type AppSpec = {
  display: string;
  processes: string[];
  executable?: string;
  uri?: string;
  webFallback?: string;
};

const APPS: Record<KnownApplication, AppSpec> = {
  notepad: { display: "Bloc-notes", processes: ["notepad.exe"], executable: "notepad.exe" },
  calculator: { display: "Calculatrice", processes: ["CalculatorApp.exe", "Calculator.exe"], executable: "calc.exe" },
  spotify: { display: "Spotify", processes: ["Spotify.exe"], uri: "spotify:", webFallback: "https://open.spotify.com/" },
  whatsapp: { display: "WhatsApp", processes: ["WhatsApp.exe", "WhatsApp.Native.exe"], uri: "whatsapp://", webFallback: "https://web.whatsapp.com/" },
  chrome: { display: "Google Chrome", processes: ["chrome.exe"], executable: "chrome.exe" },
  discord: { display: "Discord", processes: ["Discord.exe"], uri: "discord://", webFallback: "https://discord.com/app" },
  edge: { display: "Microsoft Edge", processes: ["msedge.exe"], executable: "msedge.exe" },
  firefox: { display: "Firefox", processes: ["firefox.exe"], executable: "firefox.exe" }
};

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

export function isProcessRunning(processNames: string[]): boolean {
  if (process.platform !== "win32") return false;
  for (const processName of processNames) {
    const result = spawnSync("tasklist.exe", ["/FI", `IMAGENAME eq ${processName}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 8_000 });
    if (result.status === 0 && (result.stdout || "").toLowerCase().includes(`\"${processName.toLowerCase()}\"`)) return true;
  }
  return false;
}

async function waitForProcess(processNames: string[], running: boolean, timeoutMs = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isProcessRunning(processNames) === running) return true;
    await delay(250);
  }
  return isProcessRunning(processNames) === running;
}

function resolveExecutable(app: KnownApplication, fallback: string): string {
  const under = (root: string | undefined, ...parts: string[]): string => root ? path.join(root, ...parts) : "";
  const candidates: string[] = [];
  if (app === "chrome") {
    candidates.push(
      under(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
      under(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
      under(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe")
    );
  } else if (app === "edge") {
    candidates.push(
      under(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
      under(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    );
  } else if (app === "firefox") {
    candidates.push(
      under(process.env.ProgramFiles, "Mozilla Firefox", "firefox.exe"),
      under(process.env["ProgramFiles(x86)"], "Mozilla Firefox", "firefox.exe")
    );
  } else if (app === "notepad" || app === "calculator") {
    candidates.push(path.join(process.env.SystemRoot || "C:\\Windows", "System32", fallback));
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || fallback;
}

function startExecutable(executable: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `start \"\" \"${executable.replace(/\"/g, "")}\"`], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

function openedMessage(display: string): string {
  return localText({
    fr: `${display} est bien ouvert et le processus Windows a été vérifié.`,
    en: `${display} is open and its Windows process was verified.`,
    es: `${display} está abierto y se verificó su proceso de Windows.`,
    de: `${display} ist geöffnet und der Windows-Prozess wurde überprüft.`,
    it: `${display} è aperto e il processo Windows è stato verificato.`,
    pt: `${display} está aberto e o processo do Windows foi verificado.`
  });
}

export async function launchApplication(app: KnownApplication): Promise<ApplicationActionResult> {
  if (process.platform !== "win32") return { ok: false, verified: false, target: APPS[app].display, message: "Cette action nécessite Windows." };
  const spec = APPS[app];
  if (isProcessRunning(spec.processes)) return { ok: true, verified: true, target: spec.display, message: openedMessage(spec.display) };

  try {
    if (spec.uri) await shell.openExternal(spec.uri);
    else if (spec.executable) await startExecutable(resolveExecutable(app, spec.executable));
  } catch {
    // Native launch verification below decides whether a web fallback is needed.
  }

  if (await waitForProcess(spec.processes, true)) {
    return { ok: true, verified: true, target: spec.display, message: openedMessage(spec.display) };
  }

  if (spec.webFallback) {
    try {
      await shell.openExternal(spec.webFallback);
      return {
        ok: true,
        verified: false,
        target: `${spec.display} Web`,
        message: localText({
          fr: `${spec.display} natif n’a pas été détecté. ${spec.display} Web a été demandé au navigateur.`,
          en: `${spec.display} desktop was not detected. ${spec.display} Web was sent to the browser.`,
          es: `No se detectó ${spec.display} nativo. Se abrió ${spec.display} Web en el navegador.`,
          de: `${spec.display} Desktop wurde nicht erkannt. ${spec.display} Web wurde im Browser geöffnet.`,
          it: `${spec.display} desktop non è stato rilevato. ${spec.display} Web è stato aperto nel browser.`,
          pt: `${spec.display} nativo não foi detectado. ${spec.display} Web foi aberto no navegador.`
        })
      };
    } catch { /* fall through */ }
  }

  return {
    ok: false,
    verified: false,
    target: spec.display,
    message: localText({
      fr: `Impossible de confirmer l’ouverture de ${spec.display}. Aucun processus correspondant n’a été détecté.`,
      en: `I could not confirm that ${spec.display} opened. No matching process was detected.`
    })
  };
}

export async function killApplication(app: KnownApplication): Promise<ApplicationActionResult> {
  if (process.platform !== "win32") return { ok: false, verified: false, target: APPS[app].display, message: "Cette action nécessite Windows." };
  const spec = APPS[app];
  if (!isProcessRunning(spec.processes)) {
    return {
      ok: true,
      verified: true,
      target: spec.display,
      message: localText({ fr: `${spec.display} est déjà fermé ou n’est pas lancé.`, en: `${spec.display} is already closed or not running.` })
    };
  }

  for (const name of spec.processes) spawnSync("taskkill.exe", ["/IM", name, "/T"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  if (!(await waitForProcess(spec.processes, false, 3_000))) {
    for (const name of spec.processes) spawnSync("taskkill.exe", ["/IM", name, "/T", "/F"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  }

  const closed = await waitForProcess(spec.processes, false, 3_000);
  return closed
    ? { ok: true, verified: true, target: spec.display, message: localText({ fr: `${spec.display} est fermé. Le processus Windows n’est plus présent.`, en: `${spec.display} is closed. Its Windows process is no longer present.` }) }
    : { ok: false, verified: false, target: spec.display, message: localText({ fr: `Impossible de confirmer la fermeture de ${spec.display}.`, en: `I could not confirm that ${spec.display} closed.` }) };
}

export async function openWebTarget(url: string, display: string): Promise<ApplicationActionResult> {
  try {
    await shell.openExternal(url);
    return {
      ok: true,
      verified: false,
      target: display,
      message: localText({
        fr: `${display} a été envoyé au navigateur par défaut.`,
        en: `${display} was sent to the default browser.`,
        es: `${display} se abrió en el navegador predeterminado.`,
        de: `${display} wurde im Standardbrowser geöffnet.`,
        it: `${display} è stato aperto nel browser predefinito.`,
        pt: `${display} foi aberto no navegador padrão.`
      })
    };
  } catch (error) {
    return { ok: false, verified: false, target: display, message: error instanceof Error ? error.message : String(error) };
  }
}
