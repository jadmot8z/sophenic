import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureEngineInstalled } from "./provision";
import { resolveHermes } from "./hermes";
import { runHermes } from "./config";

export type IntegrationKind = "capability" | "skill" | "plugin";
export type IntegrationPermission = {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: IntegrationKind;
  enabled: boolean;
  connected?: boolean;
  requiresSetup?: boolean;
  source?: string;
  toolset?: string;
  scopes?: string[];
};

type PermissionFile = { enabled: Record<string, boolean>; scopes: Record<string, string[]> };

const BASE_CAPABILITIES: Omit<IntegrationPermission, "enabled">[] = [
  { id: "computer_use", name: "Contrôle du PC", description: "Cliquer, taper, faire défiler et piloter les applications Windows avec Hermes Computer Use.", category: "Ordinateur", kind: "capability", toolset: "computer_use", requiresSetup: true },
  { id: "browser", name: "Navigateur", description: "Autoriser Hermes à naviguer sur le Web et à utiliser un navigateur quand une tâche le demande.", category: "Ordinateur", kind: "capability", toolset: "browser" },
  { id: "location", name: "Localisation", description: "Autoriser Sophenic à lire ta position Windows uniquement lorsque tu demandes une fonction de localisation ou « près de moi ».", category: "Ordinateur", kind: "capability", toolset: "location" },
  { id: "file", name: "Fichiers", description: "Lire et modifier les fichiers nécessaires à une tâche autorisée.", category: "Ordinateur", kind: "capability", toolset: "file" },
  { id: "terminal", name: "Terminal", description: "Exécuter des commandes dans un terminal pour les tâches que tu demandes. Les actions sensibles restent soumises aux validations Hermes.", category: "Ordinateur", kind: "capability", toolset: "terminal" },
  { id: "code_execution", name: "Exécution de code", description: "Lancer du code et des outils de développement dans l’espace Code.", category: "Développement", kind: "capability", toolset: "code_execution" },
  { id: "web", name: "Recherche Web", description: "Utiliser les outils Web Hermes pour rechercher des informations utiles à une tâche.", category: "Web", kind: "capability", toolset: "web" },
  { id: "vision", name: "Vision", description: "Analyser des captures et contenus visuels quand un modèle et les outils compatibles sont disponibles.", category: "Média", kind: "capability", toolset: "vision" },
  { id: "image_gen", name: "Génération d’images Hermes", description: "Autoriser les outils d’image fournis par Hermes lorsqu’ils sont configurés.", category: "Média", kind: "capability", toolset: "image_gen" },
  { id: "memory", name: "Mémoire Hermes", description: "Permettre à l’agent Hermes d’utiliser sa mémoire d’outil pour les sessions agentiques.", category: "Assistant", kind: "capability", toolset: "memory" },
  { id: "skills", name: "Skills Hermes", description: "Autoriser Hermes à charger ses skills installés pour accomplir les tâches demandées.", category: "Assistant", kind: "capability", toolset: "skills" },
  { id: "google-workspace", name: "Google Workspace", description: "Gmail, Agenda, Drive, Contacts, Sheets et Docs via le skill Google Workspace de Hermes. La connexion Google OAuth reste obligatoire.", category: "Comptes", kind: "skill", requiresSetup: true, scopes: ["Gmail", "Agenda", "Drive", "Contacts", "Sheets", "Docs"] }
];

// Safe development capabilities are on by default for Sophenic Code. The user can
// still explicitly disable any of them in Plugins; an explicit false always wins.
const DEFAULT_SAFE_CAPABILITIES = new Set(["browser", "file", "terminal", "code_execution", "web", "vision", "skills"]);

function permissionEnabled(permissions: PermissionFile, id: string): boolean {
  if (Object.prototype.hasOwnProperty.call(permissions.enabled, id)) return Boolean(permissions.enabled[id]);
  return DEFAULT_SAFE_CAPABILITIES.has(id);
}

function sophenicDataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}
function permissionPath(): string { return path.join(sophenicDataHome(), "permissions.json"); }
function hermesHome(): string {
  if (process.env.HERMES_HOME?.trim()) return process.env.HERMES_HOME.trim();
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "hermes");
  return path.join(os.homedir(), ".hermes");
}

function readPermissions(): PermissionFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(permissionPath(), "utf8")) as Partial<PermissionFile>;
    return {
      enabled: parsed.enabled && typeof parsed.enabled === "object" ? parsed.enabled : {},
      scopes: parsed.scopes && typeof parsed.scopes === "object" ? parsed.scopes : {}
    };
  } catch { return { enabled: {}, scopes: {} }; }
}

function writePermissions(next: PermissionFile): void {
  const target = permissionPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function readableName(raw: string): string {
  return raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

function frontmatterValue(source: string, key: string): string {
  if (!source.startsWith("---")) return "";
  const close = source.indexOf("\n---", 3);
  if (close < 0) return "";
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "mi").exec(source.slice(3, close));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function firstDescription(source: string): string {
  const fm = frontmatterValue(source, "description");
  if (fm) return fm.slice(0, 260);
  const body = source.replace(/^---[\s\S]*?---\s*/m, "");
  const line = body.split(/\r?\n/).map((v) => v.trim()).find((v) => v && !v.startsWith("#") && !v.startsWith("```"));
  return (line || "Skill Hermes installé.").slice(0, 260);
}

function walkSkillFiles(root: string, maxDepth = 5): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "venv" || entry.name === "__pycache__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") out.push(full);
    }
  };
  visit(root, 0);
  return out.slice(0, 300);
}

function dynamicSkills(): Omit<IntegrationPermission, "enabled">[] {
  const home = hermesHome();
  const roots = [path.join(home, "skills"), path.join(home, "hermes-agent", "skills")];
  const seen = new Set<string>();
  const items: Omit<IntegrationPermission, "enabled">[] = [];
  for (const root of roots) {
    for (const file of walkSkillFiles(root)) {
      let source = "";
      try { source = fs.readFileSync(file, "utf8"); } catch { continue; }
      const folder = path.basename(path.dirname(file));
      const rawId = frontmatterValue(source, "name") || folder;
      const slug = rawId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || folder.toLowerCase();
      if (!slug || slug === "google-workspace" || seen.has(slug)) continue;
      seen.add(slug);
      const name = frontmatterValue(source, "title") || frontmatterValue(source, "name") || readableName(folder);
      items.push({
        id: `skill:${slug}`,
        name: readableName(name),
        description: firstDescription(source),
        category: "Skills Hermes",
        kind: "skill",
        source: file,
        requiresSetup: /oauth|api[ _-]?key|credential|token|setup|configuration/i.test(source.slice(0, 5000))
      });
    }
  }
  return items;
}

function dynamicPlugins(): Omit<IntegrationPermission, "enabled">[] {
  const home = hermesHome();
  const roots = [path.join(home, "plugins"), path.join(home, "hermes-agent", "plugins")];
  const items: Omit<IntegrationPermission, "enabled">[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let dirs: fs.Dirent[] = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const slug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!slug || seen.has(slug)) continue;
      const dir = path.join(root, entry.name);
      const manifest = ["plugin.json", "plugin.yaml", "plugin.yml"].map((name) => path.join(dir, name)).find((candidate) => fs.existsSync(candidate));
      seen.add(slug);
      items.push({ id: `plugin:${slug}`, name: readableName(entry.name), description: "Plugin Hermes détecté sur cet ordinateur.", category: "Plugins Hermes", kind: "plugin", source: manifest || dir, requiresSetup: true });
    }
  }
  return items;
}

function googleConnected(): boolean {
  const home = hermesHome();
  return [
    path.join(home, "google_token.json"),
    path.join(home, "credentials", "google_token.json"),
    path.join(home, "skills", "productivity", "google-workspace", "google_token.json")
  ].some((candidate) => fs.existsSync(candidate));
}

function computerUseConnected(): boolean {
  if (fs.existsSync(path.join(sophenicDataHome(), "computer-use-ready"))) return true;
  const resolved = resolveHermes();
  if (!resolved.candidate) return false;
  const status = runHermes(resolved.candidate, ["computer-use", "status"], 8_000);
  return status.status === 0;
}

export function listIntegrationPermissions(): IntegrationPermission[] {
  const permissions = readPermissions();
  const all = [...BASE_CAPABILITIES, ...dynamicSkills(), ...dynamicPlugins()];
  return all.map((item) => ({
    ...item,
    enabled: permissionEnabled(permissions, item.id),
    scopes: permissions.scopes[item.id]?.length ? permissions.scopes[item.id] : item.scopes,
    ...(item.id === "google-workspace" ? { connected: googleConnected() } : {}),
    ...(item.id === "computer_use" ? { connected: computerUseConnected() } : {})
  }));
}

export function integrationEnabled(id: string): boolean {
  return permissionEnabled(readPermissions(), id);
}

export function setIntegrationPermission(id: string, enabled: boolean, scopes?: string[]): IntegrationPermission[] {
  if (!id.trim()) throw new Error("Intégration invalide.");
  const current = readPermissions();
  current.enabled[id] = enabled;
  if (Array.isArray(scopes)) current.scopes[id] = scopes.map((scope) => String(scope).trim()).filter(Boolean).slice(0, 30);
  writePermissions(current);
  return listIntegrationPermissions();
}

export async function setupComputerUse(): Promise<{ ok: boolean; message: string }> {
  await ensureEngineInstalled();
  const resolved = resolveHermes();
  if (!resolved.candidate) throw new Error("Hermes n’a pas été détecté après son installation.");
  const result = runHermes(resolved.candidate, ["computer-use", "install"], 240_000);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Installation de Computer Use impossible.").trim().slice(0, 2000));
  fs.mkdirSync(sophenicDataHome(), { recursive: true });
  fs.writeFileSync(path.join(sophenicDataHome(), "computer-use-ready"), `${new Date().toISOString()}\n`, "utf8");
  return { ok: true, message: "Hermes Computer Use est prêt." };
}

function googleSetupScript(): string | null {
  const home = hermesHome();
  const candidates = [
    path.join(home, "skills", "productivity", "google-workspace", "scripts", "setup.py"),
    path.join(home, "hermes-agent", "skills", "productivity", "google-workspace", "scripts", "setup.py"),
    path.join(home, "skills", "google-workspace", "scripts", "setup.py"),
    path.join(home, "hermes-agent", "skills", "google-workspace", "scripts", "setup.py")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function hermesPython(): string | null {
  const resolved = resolveHermes();
  const executable = resolved.candidate?.executable;
  if (!executable) return null;
  const dir = path.dirname(executable);
  const windows = path.join(dir, "python.exe");
  const unix = path.join(dir, "python");
  if (fs.existsSync(windows)) return windows;
  if (fs.existsSync(unix)) return unix;
  return process.platform === "win32" ? "python" : "python3";
}

function runGoogleSetup(args: string[], timeout = 120_000): { status: number | null; stdout: string; stderr: string } {
  const script = googleSetupScript();
  const python = hermesPython();
  if (!script || !python) throw new Error("Le skill Google Workspace de Hermes n’est pas installé. Ouvre la configuration Hermes pour l’ajouter/configurer.");
  const result = spawnSync(python, [script, ...args], { encoding: "utf8", timeout, windowsHide: true, shell: false, env: process.env });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function extractUrl(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const possible = [parsed.auth_url, parsed.url, parsed.authorization_url];
    const value = possible.find((entry) => typeof entry === "string") as string | undefined;
    if (value) return value;
  } catch { /* plain-text output below */ }
  return /https:\/\/[^\s"']+/.exec(text)?.[0] || "";
}

export function startGoogleOAuth(clientSecretPath: string): { authUrl: string; message: string } {
  if (!fs.existsSync(clientSecretPath)) throw new Error("Le fichier OAuth Google sélectionné est introuvable.");
  const importResult = runGoogleSetup(["--client-secret", clientSecretPath], 60_000);
  if (importResult.status !== 0) throw new Error((importResult.stderr || importResult.stdout || "Impossible d’importer le client OAuth Google.").trim().slice(0, 2000));
  const authResult = runGoogleSetup(["--auth-url", "--services", "email,calendar,drive,contacts,sheets,docs", "--format", "json"], 60_000);
  if (authResult.status !== 0) throw new Error((authResult.stderr || authResult.stdout || "Impossible de créer l’URL Google OAuth.").trim().slice(0, 2000));
  const authUrl = extractUrl(`${authResult.stdout}\n${authResult.stderr}`);
  if (!authUrl) throw new Error("Hermes n’a pas renvoyé l’URL d’autorisation Google.");
  return { authUrl, message: "Autorise Sophenic dans Google, puis colle dans Sophenic l’URL localhost affichée par ton navigateur." };
}

export function finishGoogleOAuth(redirectUrl: string): { ok: boolean; message: string } {
  const clean = redirectUrl.trim();
  if (!clean || (!clean.startsWith("http://localhost") && !clean.startsWith("http://127.0.0.1"))) {
    throw new Error("Colle l’URL localhost complète affichée après l’autorisation Google.");
  }
  const result = runGoogleSetup(["--auth-code", clean, "--format", "json"], 120_000);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Connexion Google impossible.").trim().slice(0, 2000));
  const check = runGoogleSetup(["--check"], 60_000);
  if (check.status !== 0) throw new Error((check.stderr || check.stdout || "Google a répondu mais la connexion n’a pas pu être vérifiée.").trim().slice(0, 2000));
  return { ok: true, message: "Google Workspace est connecté à Hermes pour Sophenic." };
}
