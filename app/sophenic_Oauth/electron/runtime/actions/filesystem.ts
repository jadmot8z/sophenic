import { app, dialog, shell, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { localText } from "../localization";

export type FileActionResult = { ok: boolean; message: string; target?: string; verified?: boolean };

function safeLeafName(value: string, fallback: string): string {
  const clean = value.replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, ".").trim();
  return (clean || fallback).slice(0, 120);
}

async function openPathVerified(target: string, display: string): Promise<FileActionResult> {
  if (!fs.existsSync(target)) return { ok: false, verified: false, target, message: `${display}: chemin introuvable.` };
  const error = await shell.openPath(target);
  if (error) return { ok: false, verified: false, target, message: error };
  return {
    ok: true,
    verified: true,
    target,
    message: localText({
      fr: `${display} est ouvert.`, en: `${display} is open.`, es: `${display} está abierto.`, de: `${display} ist geöffnet.`, it: `${display} è aperto.`, pt: `${display} está aberto.`
    })
  };
}

export async function openKnownFolder(folder: "downloads" | "desktop"): Promise<FileActionResult> {
  const target = app.getPath(folder);
  return openPathVerified(target, folder === "downloads" ? "Téléchargements" : "Bureau");
}

export async function chooseAndOpenFile(owner?: BrowserWindow | null): Promise<FileActionResult> {
  const options = { title: localText({ fr: "Ouvrir un fichier", en: "Open a file" }), properties: ["openFile"] as "openFile"[] };
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return { ok: true, verified: true, message: localText({ fr: "Ouverture de fichier annulée.", en: "File opening cancelled." }) };
  return openPathVerified(result.filePaths[0], path.basename(result.filePaths[0]));
}

export function createDesktopDirectory(name: string): FileActionResult {
  try {
    const safeName = safeLeafName(name, "Nouveau dossier");
    const target = path.join(app.getPath("desktop"), safeName);
    fs.mkdirSync(target, { recursive: false });
    const verified = fs.existsSync(target) && fs.statSync(target).isDirectory();
    return {
      ok: verified,
      verified,
      target,
      message: verified
        ? localText({ fr: `Dossier créé sur le Bureau : ${safeName}`, en: `Folder created on the Desktop: ${safeName}`, es: `Carpeta creada en el Escritorio: ${safeName}`, de: `Ordner auf dem Desktop erstellt: ${safeName}`, it: `Cartella creata sul Desktop: ${safeName}`, pt: `Pasta criada na Área de Trabalho: ${safeName}` })
        : localText({ fr: "Le dossier n’a pas pu être vérifié après sa création.", en: "The folder could not be verified after creation." })
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, verified: true, message: localText({ fr: "Un dossier portant ce nom existe déjà sur le Bureau.", en: "A folder with that name already exists on the Desktop." }) };
    return { ok: false, verified: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function createDesktopFile(name: string): FileActionResult {
  try {
    let safeName = safeLeafName(name, "nouveau-fichier.txt");
    if (!/\.[a-z0-9]{1,12}$/i.test(safeName)) safeName += ".txt";
    const target = path.join(app.getPath("desktop"), safeName);
    const fd = fs.openSync(target, "wx");
    fs.closeSync(fd);
    const verified = fs.existsSync(target) && fs.statSync(target).isFile();
    return {
      ok: verified,
      verified,
      target,
      message: verified
        ? localText({ fr: `Fichier créé sur le Bureau : ${safeName}`, en: `File created on the Desktop: ${safeName}`, es: `Archivo creado en el Escritorio: ${safeName}`, de: `Datei auf dem Desktop erstellt: ${safeName}`, it: `File creato sul Desktop: ${safeName}`, pt: `Arquivo criado na Área de Trabalho: ${safeName}` })
        : localText({ fr: "Le fichier n’a pas pu être vérifié après sa création.", en: "The file could not be verified after creation." })
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, verified: true, message: localText({ fr: "Un fichier portant ce nom existe déjà sur le Bureau.", en: "A file with that name already exists on the Desktop." }) };
    return { ok: false, verified: false, message: error instanceof Error ? error.message : String(error) };
  }
}
