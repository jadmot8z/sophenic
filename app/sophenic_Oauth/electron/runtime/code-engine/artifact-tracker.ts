import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Detects real files produced by a Sophenic Code run — whatever created them:
// filesystem tools, terminal commands (Compress-Archive, zip, exporters...),
// image generation or any other subprocess that touched the workspace.
// A file is reported ONLY if it did not exist when the run started, so an
// already-present file is never presented as newly generated.

export type CodeArtifact = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  kind: "archive" | "document" | "image" | "text" | "media" | "other";
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type WorkspaceFileSnapshot = Map<string, { size: number; mtimeMs: number }>;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".turbo", ".cache", "__pycache__", ".venv", "venv",
  "dist-electron", "coverage", ".sophenic", ".pytest_cache", ".mypy_cache", ".ruff-cache", "target"
]);

// Extensions a user would consider a "deliverable". Ranked: the most useful
// artifacts (archives, documents, images) are surfaced first even when a code
// run produced hundreds of intermediate source files.
const DELIVERABLE_EXTENSIONS = new Set([
  ".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi", ".mkv",
  ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".html", ".htm"
]);

const KIND_BY_EXTENSION: Record<string, CodeArtifact["kind"]> = {
  ".zip": "archive", ".7z": "archive", ".rar": "archive", ".tar": "archive", ".gz": "archive", ".tgz": "archive", ".bz2": "archive", ".xz": "archive",
  ".pdf": "document", ".doc": "document", ".docx": "document", ".xls": "document", ".xlsx": "document", ".ppt": "document", ".pptx": "document", ".odt": "document", ".ods": "document",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".bmp": "image", ".ico": "image",
  ".mp3": "media", ".mp4": "media", ".wav": "media", ".ogg": "media", ".webm": "media", ".mov": "media", ".avi": "media", ".mkv": "media",
  ".txt": "text", ".md": "text", ".csv": "text", ".json": "text", ".xml": "text", ".yaml": "text", ".yml": "text", ".html": "text", ".htm": "text"
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".zip": "application/zip", ".7z": "application/x-7z-compressed", ".rar": "application/vnd.rar", ".tar": "application/x-tar", ".gz": "application/gzip",
  ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json", ".xml": "application/xml", ".html": "text/html", ".htm": "text/html",
  ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".wav": "audio/wav", ".webm": "video/webm"
};

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function snapshotWorkspaceFiles(root: string): WorkspaceFileSnapshot {
  const snapshot: WorkspaceFileSnapshot = new Map();
  const visit = (dir: string, depth: number) => {
    if (depth > 12 || snapshot.size > 20_000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (snapshot.size > 20_000) break;
      if (entry.name.startsWith(".sophenic")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        visit(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          snapshot.set(normalizeSlashes(path.relative(root, full)), { size: stat.size, mtimeMs: stat.mtimeMs });
        } catch { /* transient file: ignore */ }
      }
    }
  };
  try { visit(path.resolve(root), 0); } catch { /* unreadable workspace: empty snapshot */ }
  return snapshot;
}

// A generated file must be complete before it is shown to the user: the size
// must be stable (> 0 bytes) across two probes. Zips produced by a shell
// command are normally already complete when the command returns, but
// exporters and async writers may still be flushing.
export async function waitForStableFile(file: string, attempts = 6, intervalMs = 350): Promise<{ size: number; mtimeMs: number } | null> {
  let previous: { size: number; mtimeMs: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size > 0) {
        if (previous && previous.size === stat.size) return { size: stat.size, mtimeMs: stat.mtimeMs };
        previous = { size: stat.size, mtimeMs: stat.mtimeMs };
      } else {
        previous = null;
      }
    } catch {
      previous = null;
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return previous && previous.size > 0 ? previous : null;
}

function artifactId(file: string, stat: { size: number; mtimeMs: number }): string {
  return createHash("sha256").update(`${normalizeSlashes(file)}::${stat.size}::${Math.round(stat.mtimeMs)}`).digest("hex").slice(0, 20);
}

export async function detectWorkspaceArtifacts(root: string, before: WorkspaceFileSnapshot, max = 8): Promise<CodeArtifact[]> {
  const resolvedRoot = path.resolve(root);
  const after = snapshotWorkspaceFiles(resolvedRoot);
  const candidates: Array<{ relative: string; stat: { size: number; mtimeMs: number } }> = [];
  for (const [relative, stat] of after) {
    if (before.has(relative)) continue; // existed before the run → not a new artifact
    candidates.push({ relative, stat });
  }
  if (!candidates.length) return [];

  const deliverableFirst = (left: { relative: string }, right: { relative: string }) => {
    const leftScore = DELIVERABLE_EXTENSIONS.has(path.extname(left.relative).toLowerCase()) ? 0 : 1;
    const rightScore = DELIVERABLE_EXTENSIONS.has(path.extname(right.relative).toLowerCase()) ? 0 : 1;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.relative.localeCompare(right.relative);
  };
  candidates.sort(deliverableFirst);

  const artifacts: CodeArtifact[] = [];
  for (const candidate of candidates) {
    if (artifacts.length >= max) break;
    const absolute = path.join(resolvedRoot, candidate.relative);
    const stable = await waitForStableFile(absolute);
    if (!stable) continue; // still being written or already removed: never show an unfinished file
    const extension = path.extname(candidate.relative).toLowerCase();
    artifacts.push({
      id: artifactId(absolute, stable),
      name: path.basename(candidate.relative),
      path: absolute,
      relativePath: candidate.relative,
      extension: extension.slice(1),
      kind: KIND_BY_EXTENSION[extension] || "other",
      mimeType: MIME_BY_EXTENSION[extension] || "application/octet-stream",
      sizeBytes: stable.size,
      createdAt: new Date(stable.mtimeMs || Date.now()).toISOString()
    });
  }
  return artifacts;
}
