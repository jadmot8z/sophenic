import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodeWorkspaceKind = "managed" | "external-project" | "external-file";

export type CodeWorkspaceCheckpoint = {
  workspace: string;
  originalPrompt: string;
  planSteps: string[];
  activeStep?: number;
  activeProvider: string;
  activeModel: string;
  savedAt: number;
  reason?: string;
  workspaceKind?: CodeWorkspaceKind;
  targetFile?: string;
  progressDigest?: string;
};

export type CodeWorkspaceInfo = {
  workspace: string;
  kind: CodeWorkspaceKind;
  targetFile?: string;
  projectId?: string;
  createdAt?: string;
  stateDir: string;
};

export type CodeWorkspaceHandoff = {
  workspace: string;
  stateDir: string;
  summary: string;
  files: string[];
  recentFiles: string[];
  gitStatus: string[];
  checkpoint?: CodeWorkspaceCheckpoint | null;
};

function dataHome(): string {
  if (process.platform === "win32" && process.env.LOCALAPPDATA?.trim()) return path.join(process.env.LOCALAPPDATA, "Sophenic");
  return path.join(os.homedir(), ".sophenic");
}

export function codeWorkspaceRoot(): string {
  return path.join(dataHome(), "workspace");
}

export function managedCodeWorkspaceRoot(): string {
  return path.join(codeWorkspaceRoot(), "projects");
}

function legacyManagedCodeWorkspaceRoot(): string {
  return path.join(dataHome(), "workspaces");
}

export function ensureCodeWorkspaceLayout(): { root: string; projects: string; logs: string; checkpoints: string; versions: string; tests: string; delivery: string } {
  const root = codeWorkspaceRoot();
  const layout = {
    root,
    projects: path.join(root, "projects"),
    logs: path.join(root, "logs"),
    checkpoints: path.join(root, "checkpoints"),
    versions: path.join(root, "versions"),
    tests: path.join(root, "tests"),
    delivery: path.join(root, "delivery")
  };
  for (const dir of Object.values(layout).slice(1)) fs.mkdirSync(dir, { recursive: true });
  return layout;
}

function externalStateRoot(): string {
  return path.join(dataHome(), "code-state");
}

function slugifyPrompt(prompt: string): string {
  const normalized = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return normalized || "projet";
}

function compactTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isManagedCodeWorkspace(workspace: string): boolean {
  if (!workspace.trim()) return false;
  return isInside(workspace, managedCodeWorkspaceRoot()) || isInside(workspace, legacyManagedCodeWorkspaceRoot());
}

function stateDirForWorkspace(workspace: string): string {
  const resolved = path.resolve(workspace);
  if (isManagedCodeWorkspace(resolved)) return path.join(resolved, ".sophenic");
  const hash = createHash("sha256").update(resolved.toLowerCase()).digest("hex").slice(0, 20);
  return path.join(externalStateRoot(), hash);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

export function createManagedCodeWorkspace(prompt: string): CodeWorkspaceInfo {
  const layout = ensureCodeWorkspaceLayout();
  const root = layout.projects;
  const projectId = `${compactTimestamp()}-${slugifyPrompt(prompt)}-${randomBytes(2).toString("hex")}`;
  const workspace = path.join(root, projectId);
  const stateDir = path.join(workspace, ".sophenic");
  fs.mkdirSync(path.join(stateDir, "research"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "delivery"), { recursive: true });
  const createdAt = new Date().toISOString();
  atomicWriteJson(path.join(stateDir, "workspace.json"), {
    schema: 1,
    projectId,
    createdAt,
    kind: "managed",
    workspace,
    originalPrompt: prompt.trim().slice(0, 12_000)
  });
  fs.writeFileSync(path.join(stateDir, "README.txt"), [
    "SOPHENIC CODE WORKSPACE",
    "",
    "Ce dossier .sophenic contient l'état local du projet (checkpoint, recherches, captures, logs, tests et livraison).",
    `Le workspace global Sophenic est ${codeWorkspaceRoot()} avec projects/, logs/, checkpoints/, versions/, tests/ et delivery/.`,
    "Le projet créé par l'agent reste libre d'utiliser la structure de fichiers et la technologie les plus adaptées à la demande."
  ].join("\n"), "utf8");
  return { workspace, kind: "managed", projectId, createdAt, stateDir };
}

export function externalProjectInfo(workspace: string): CodeWorkspaceInfo {
  const resolved = path.resolve(workspace);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error("Le dossier projet sélectionné est introuvable.");
  return { workspace: resolved, kind: "external-project", stateDir: stateDirForWorkspace(resolved) };
}

export function externalFileInfo(filePath: string): CodeWorkspaceInfo {
  const resolvedFile = path.resolve(filePath);
  if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) throw new Error("Le fichier sélectionné est introuvable.");
  const workspace = path.dirname(resolvedFile);
  return { workspace, kind: "external-file", targetFile: resolvedFile, stateDir: stateDirForWorkspace(workspace) };
}

export function saveCodeWorkspaceCheckpoint(checkpoint: CodeWorkspaceCheckpoint): void {
  if (!checkpoint.workspace?.trim()) return;
  const resolved = path.resolve(checkpoint.workspace);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
  const stateDir = stateDirForWorkspace(resolved);
  const payload = { schema: 3, ...checkpoint, workspace: resolved };
  atomicWriteJson(path.join(stateDir, "checkpoint.json"), payload);
  if (isManagedCodeWorkspace(resolved)) {
    const layout = ensureCodeWorkspaceLayout();
    atomicWriteJson(path.join(layout.checkpoints, `${path.basename(resolved)}.json`), payload);
  }
}

export function clearCodeWorkspaceCheckpoint(workspace: string): void {
  if (!workspace.trim()) return;
  const target = path.join(stateDirForWorkspace(workspace), "checkpoint.json");
  try { fs.rmSync(target, { force: true }); } catch { /* optional state */ }
  if (isManagedCodeWorkspace(workspace)) {
    try { fs.rmSync(path.join(ensureCodeWorkspaceLayout().checkpoints, `${path.basename(path.resolve(workspace))}.json`), { force: true }); } catch { /* optional global state */ }
  }
}

export function loadCodeWorkspaceCheckpoint(workspace: string): CodeWorkspaceCheckpoint | null {
  if (!workspace.trim()) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDirForWorkspace(workspace), "checkpoint.json"), "utf8")) as CodeWorkspaceCheckpoint;
    return parsed && parsed.workspace ? parsed : null;
  } catch { return null; }
}

export function findLatestCodeWorkspaceCheckpoint(): CodeWorkspaceCheckpoint | null {
  const candidates: Array<{ checkpoint: CodeWorkspaceCheckpoint; mtime: number }> = [];
  const layout = ensureCodeWorkspaceLayout();
  const roots = [layout.checkpoints];
  for (const dir of roots) {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(dir, entry.name);
      try {
        const checkpoint = JSON.parse(fs.readFileSync(file, "utf8")) as CodeWorkspaceCheckpoint;
        if (!checkpoint?.workspace || !fs.existsSync(checkpoint.workspace)) continue;
        candidates.push({ checkpoint, mtime: fs.statSync(file).mtimeMs });
      } catch { /* ignore damaged checkpoint */ }
    }
  }
  // Compatibility with pre-6.0 managed workspaces that stored only .sophenic/checkpoint.json.
  for (const root of [legacyManagedCodeWorkspaceRoot(), managedCodeWorkspaceRoot()]) {
    let projects: fs.Dirent[] = [];
    try { projects = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const file = path.join(root, project.name, ".sophenic", "checkpoint.json");
      if (!fs.existsSync(file)) continue;
      try {
        const checkpoint = JSON.parse(fs.readFileSync(file, "utf8")) as CodeWorkspaceCheckpoint;
        if (checkpoint?.workspace && fs.existsSync(checkpoint.workspace)) candidates.push({ checkpoint, mtime: fs.statSync(file).mtimeMs });
      } catch { /* compatibility file may be partial */ }
    }
  }
  return candidates.sort((a, b) => b.mtime - a.mtime)[0]?.checkpoint || null;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "dist-electron", "coverage", "build", ".turbo", ".cache", "__pycache__", ".venv", "venv"]);

function scanWorkspace(workspace: string): Array<{ relative: string; mtimeMs: number; size: number }> {
  const rows: Array<{ relative: string; mtimeMs: number; size: number }> = [];
  const root = path.resolve(workspace);
  const visit = (dir: string, depth: number) => {
    if (depth > 7 || rows.length >= 220) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (rows.length >= 220) break;
      if (entry.name === ".sophenic") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(full);
        rows.push({ relative: path.relative(root, full).replace(/\\/g, "/"), mtimeMs: stat.mtimeMs, size: stat.size });
      } catch { /* race with the builder */ }
    }
  };
  visit(root, 0);
  return rows;
}

function gitStatus(workspace: string): string[] {
  try {
    const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], { cwd: workspace, encoding: "utf8", timeout: 4_000, windowsHide: true, shell: false });
    if (result.status !== 0) return [];
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).slice(0, 80);
  } catch { return []; }
}

export function buildCodeWorkspaceHandoff(input: { workspace: string; checkpoint?: CodeWorkspaceCheckpoint | null; targetFile?: string }): CodeWorkspaceHandoff {
  const workspace = path.resolve(input.workspace);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) throw new Error("Workspace Sophenic Code introuvable pour la reprise.");
  const stateDir = stateDirForWorkspace(workspace);
  fs.mkdirSync(stateDir, { recursive: true });
  const checkpoint = input.checkpoint ?? loadCodeWorkspaceCheckpoint(workspace);
  const rows = scanWorkspace(workspace);
  const files = rows.map((item) => item.relative).sort((a, b) => a.localeCompare(b)).slice(0, 180);
  const recentFiles = [...rows].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 24).map((item) => item.relative);
  const status = gitStatus(workspace);
  const activeStep = checkpoint?.activeStep !== undefined && checkpoint.planSteps?.length
    ? `${checkpoint.activeStep + 1}/${checkpoint.planSteps.length} — ${checkpoint.planSteps[Math.min(checkpoint.activeStep, checkpoint.planSteps.length - 1)]}`
    : "non déterminée";
  const targetFile = input.targetFile || checkpoint?.targetFile || "";
  const summary = [
    `Workspace: ${workspace}`,
    targetFile ? `Fichier cible: ${targetFile}` : "",
    checkpoint ? `Étape checkpoint: ${activeStep}` : "Aucun checkpoint structuré disponible.",
    checkpoint?.reason ? `Dernier état: ${checkpoint.reason}` : "",
    recentFiles.length ? `Fichiers récemment modifiés: ${recentFiles.join(", ")}` : "Aucun fichier de projet détecté pour l'instant.",
    status.length ? `Git status: ${status.join(" | ")}` : "Git status: aucun changement détecté ou dépôt Git absent."
  ].filter(Boolean).join("\n");
  const payload = { schema: 1, generatedAt: new Date().toISOString(), workspace, targetFile: targetFile || undefined, checkpoint, files, recentFiles, gitStatus: status, summary };
  atomicWriteJson(path.join(stateDir, "handoff.json"), payload);
  fs.writeFileSync(path.join(stateDir, "handoff.md"), [
    "# SOPHENIC CODE — HANDOFF",
    "",
    "Ce fichier est régénéré à chaque reprise/fallback. Le nouveau builder doit continuer l'état réel et ne jamais recommencer le projet sans nécessité.",
    "",
    "```text",
    summary,
    "```",
    "",
    "## Arborescence utile",
    ...files.map((file) => `- ${file}`),
    ...(status.length ? ["", "## Git status", "```text", ...status, "```"] : [])
  ].join("\n"), "utf8");
  return { workspace, stateDir, summary, files, recentFiles, gitStatus: status, checkpoint };
}
