import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function secretPath(name: string): string | null {
  if (!app.isReady()) return null;
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return path.join(app.getPath("userData"), "connector-secrets", `${safeName}.enc`);
}

export function readConnectorSecret(name: string): string {
  const file = secretPath(name);
  if (!file || !safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return "";
  try { return safeStorage.decryptString(fs.readFileSync(file)).trim(); } catch { return ""; }
}

export function writeConnectorSecret(name: string, value: string): void {
  const clean = value.trim();
  if (!clean) return;
  const file = secretPath(name);
  if (!file) throw new Error("Le coffre connecteur n'est disponible qu'après le démarrage d'Electron.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le chiffrement natif du système n'est pas disponible; le secret n'a pas été enregistré.");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, safeStorage.encryptString(clean));
  fs.renameSync(temp, file);
}

export function clearConnectorSecret(name: string): void {
  const file = secretPath(name);
  if (file) try { fs.rmSync(file, { force: true }); } catch {}
}
