import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runSafeCommand, type TerminalShell } from "./safe-terminal";
import { DockerSandbox } from "./connectors/docker-sandbox";
import { PlaywrightAgent } from "./connectors/playwright-agent";
import { GithubConnector } from "./connectors/github";
import { VercelConnector } from "./connectors/vercel";
import { WebResearchConnector } from "./web-research";
import { EnvironmentManager } from "./environment-manager";
import { ensureCodeWorkspaceLayout } from "../code-workspace";
import { generateSophenicImage } from "../image-router";

export type CodeToolName =
  | "filesystem.list" | "filesystem.read" | "filesystem.write" | "filesystem.replace" | "filesystem.mkdir" | "filesystem.delete"
  | "terminal.run" | "project.verify" | "environment.inspect"
  | "docker.inspect" | "docker.run" | "docker.compose"
  | "browser.open" | "browser.click" | "browser.fill" | "browser.press" | "browser.inspect" | "browser.screenshot"
  | "web.search" | "web.fetch" | "image.generate"
  | "github.status" | "github.oauth_start" | "github.oauth_poll" | "github.search_repositories" | "github.search_code" | "github.create_repo" | "github.commit" | "github.push"
  | "vercel.status" | "vercel.logs" | "vercel.deploy";

export type CodeToolResult = { ok: boolean; tool: string; output: unknown; changedFiles?: string[]; exitCode?: number };

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "dist-electron", "coverage", ".cache", ".turbo", "__pycache__", ".venv", "venv"]);

function obj(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function bool(value: unknown, fallback = false): boolean { return typeof value === "boolean" ? value : fallback; }
function num(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

export class CodeToolExecutor {
  readonly docker = new DockerSandbox();
  readonly browser = new PlaywrightAgent();
  readonly github = new GithubConnector();
  readonly vercel = new VercelConnector();
  readonly web = new WebResearchConnector();
  readonly environment = new EnvironmentManager();

  constructor(public readonly workspace: string) {
    const root = path.resolve(workspace);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Workspace Sophenic Code introuvable.");
    this.workspace = root;
  }

  private resolveInside(relative = "."): string {
    const value = relative.trim() || ".";
    const target = path.resolve(this.workspace, value);
    const rel = path.relative(this.workspace, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Accès refusé en dehors du workspace Sophenic Code.");
    return target;
  }

  private relative(file: string): string { return path.relative(this.workspace, file).replace(/\\/g, "/") || "."; }

  private listTree(relative: string, depth: number): string[] {
    const root = this.resolveInside(relative);
    const out: string[] = [];
    const visit = (dir: string, level: number) => {
      if (level > depth || out.length >= 500) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (out.length >= 500) break;
        if (entry.name === ".sophenic") continue;
        const full = path.join(dir, entry.name);
        const rel = this.relative(full);
        out.push(entry.isDirectory() ? `${rel}/` : rel);
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name.toLowerCase())) visit(full, level + 1);
      }
    };
    if (!fs.existsSync(root)) throw new Error(`Chemin introuvable: ${relative}`);
    if (fs.statSync(root).isDirectory()) visit(root, 0); else out.push(this.relative(root));
    return out;
  }

  private readFile(relative: string, startLine = 1, endLine = 400): { path: string; content: string; totalLines: number } {
    const file = this.resolveInside(relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Fichier introuvable: ${relative}`);
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split(/\r?\n/);
    const start = Math.max(1, Math.floor(startLine));
    const end = Math.max(start, Math.min(lines.length, Math.floor(endLine)));
    const content = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
    return { path: this.relative(file), content: content.slice(0, 40_000), totalLines: lines.length };
  }

  private writeFile(relative: string, content: string): string {
    const file = this.resolveInside(relative);
    if (file === this.workspace) throw new Error("Impossible d’écrire sur la racine du workspace.");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.backupBeforeMutation(file);
    fs.writeFileSync(file, content, "utf8");
    return this.relative(file);
  }

  private workspaceKey(): string { return createHash("sha256").update(this.workspace.toLowerCase()).digest("hex").slice(0, 16); }

  private backupBeforeMutation(file: string): void {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
    const layout = ensureCodeWorkspaceLayout();
    const rel = this.relative(file).replace(/[^A-Za-z0-9._/-]+/g, "_").replace(/[\/]+/g, "__");
    const dir = path.join(layout.versions, this.workspaceKey());
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, `${Date.now()}-${rel}`));
  }

  private logAction(tool: string, args: Record<string, unknown>, result: CodeToolResult): void {
    try {
      const layout = ensureCodeWorkspaceLayout();
      const file = path.join(layout.logs, `${this.workspaceKey()}.ndjson`);
      const safeArgs = { ...args };
      for (const key of Object.keys(safeArgs)) if (/token|secret|password|api.?key/i.test(key)) safeArgs[key] = "[redacted]";
      fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), workspace: this.workspace, tool, ok: result.ok, exitCode: result.exitCode, args: safeArgs })}\n`, "utf8");
    } catch {}
  }

  private async generateImage(args: Record<string, unknown>): Promise<CodeToolResult> {
    const prompt = str(args.prompt).trim();
    if (!prompt) throw new Error("Prompt image requis.");
    const result = await generateSophenicImage({ prompt, ...(str(args.aspectRatio) ? { aspectRatio: str(args.aspectRatio) } : {}), quality: (["low", "medium", "high"].includes(str(args.quality)) ? str(args.quality) : "auto") as "auto" | "low" | "medium" | "high" });
    const first = result.images[0];
    if (!first?.url) throw new Error("Le moteur image n'a renvoyé aucun fichier exploitable.");
    const target = this.resolveInside(str(args.path, path.join("assets", `sophenic-${Date.now()}.png`)));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (first.url.startsWith("data:")) {
      const match = first.url.match(/^data:[^;]+;base64,(.+)$/s);
      if (!match) throw new Error("Image base64 invalide.");
      fs.writeFileSync(target, Buffer.from(match[1], "base64"));
    } else {
      const response = await fetch(first.url, { signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`Téléchargement image HTTP ${response.status}`);
      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    }
    return { ok: true, tool: "image.generate", output: { path: this.relative(target), provider: result.provider, model: result.model, alternatives: result.images.length }, changedFiles: [this.relative(target)] };
  }

  private persistVerification(passed: boolean, commands: Array<{ command: string; code: number; output: string }>): { passed: boolean; commands: Array<{ command: string; code: number; output: string }> } {
    const payload = { passed, commands };
    try {
      const layout = ensureCodeWorkspaceLayout();
      const dir = path.join(layout.tests, this.workspaceKey());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${Date.now()}-quality-gate.json`), `${JSON.stringify({ at: new Date().toISOString(), workspace: this.workspace, ...payload }, null, 2)}\n`, "utf8");
    } catch {}
    return payload;
  }

  async verifyProject(): Promise<{ passed: boolean; commands: Array<{ command: string; code: number; output: string }> }> {
    const results: Array<{ command: string; code: number; output: string }> = [];
    const packageFile = path.join(this.workspace, "package.json");
    if (fs.existsSync(packageFile)) {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")) as { scripts?: Record<string, string> };
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      if (!fs.existsSync(path.join(this.workspace, "node_modules"))) {
        const install = await runSafeCommand(`${npm} install --no-audit --no-fund`, this.workspace, { timeoutMs: 600_000 });
        results.push({ command: "npm install", code: install.code, output: install.output.slice(-18_000) });
        if (install.code !== 0) return this.persistVerification(false, results);
      }
      const scripts = pkg.scripts || {};
      const checks = ["typecheck", "test", "lint", "build"].filter((name) => Boolean(scripts[name]));
      for (const name of checks) {
        const result = await runSafeCommand(`${npm} run ${name}`, this.workspace, { timeoutMs: name === "build" ? 600_000 : 300_000 });
        results.push({ command: `npm run ${name}`, code: result.code, output: result.output.slice(-18_000) });
        if (result.code !== 0) return this.persistVerification(false, results);
      }
      return this.persistVerification(true, results);
    }

    const pyproject = path.join(this.workspace, "pyproject.toml");
    const requirements = path.join(this.workspace, "requirements.txt");
    if (fs.existsSync(pyproject) || fs.existsSync(requirements)) {
      const python = process.platform === "win32" ? "python" : "python3";
      const result = await runSafeCommand(`${python} -m pytest -q`, this.workspace, { timeoutMs: 300_000 });
      results.push({ command: "python -m pytest -q", code: result.code, output: result.output.slice(-18_000) });
      return this.persistVerification(result.code === 0, results);
    }
    return this.persistVerification(true, [{ command: "auto-detect", code: 0, output: "Aucun Quality Gate standard détecté; le modèle doit valider avec les commandes adaptées au projet." }]);
  }

  private async executeRaw(tool: CodeToolName | string, rawArgs: unknown): Promise<CodeToolResult> {
    const args = obj(rawArgs);
    try {
      switch (tool) {
        case "filesystem.list": return { ok: true, tool, output: this.listTree(str(args.path, "."), Math.max(0, Math.min(6, num(args.depth, 3)))) };
        case "filesystem.read": return { ok: true, tool, output: this.readFile(str(args.path), num(args.startLine, 1), num(args.endLine, 400)) };
        case "filesystem.write": {
          const file = this.writeFile(str(args.path), str(args.content));
          return { ok: true, tool, output: `Écrit: ${file}`, changedFiles: [file] };
        }
        case "filesystem.replace": {
          const relative = str(args.path);
          const file = this.resolveInside(relative);
          if (!fs.existsSync(file)) throw new Error(`Fichier introuvable: ${relative}`);
          const before = str(args.oldText);
          if (!before) throw new Error("oldText est requis.");
          const current = fs.readFileSync(file, "utf8");
          if (!current.includes(before)) throw new Error("Le texte à remplacer n’existe pas exactement dans le fichier.");
          const after = str(args.newText);
          const next = bool(args.replaceAll) ? current.split(before).join(after) : current.replace(before, after);
          this.backupBeforeMutation(file);
          fs.writeFileSync(file, next, "utf8");
          return { ok: true, tool, output: `Modifié: ${this.relative(file)}`, changedFiles: [this.relative(file)] };
        }
        case "filesystem.mkdir": {
          const dir = this.resolveInside(str(args.path)); fs.mkdirSync(dir, { recursive: true });
          return { ok: true, tool, output: `Dossier créé: ${this.relative(dir)}` };
        }
        case "filesystem.delete": {
          const target = this.resolveInside(str(args.path));
          if (target === this.workspace || /(?:^|[\\/])\.git(?:[\\/]|$)/i.test(target)) throw new Error("Suppression refusée pour ce chemin protégé.");
          if (!fs.existsSync(target)) return { ok: true, tool, output: "Déjà absent." };
          const stat = fs.statSync(target);
          if (stat.isDirectory() && fs.readdirSync(target).length && !bool(args.recursive)) throw new Error("Dossier non vide: recursive=true est requis.");
          if (stat.isFile()) this.backupBeforeMutation(target);
          fs.rmSync(target, { recursive: stat.isDirectory() && bool(args.recursive), force: true });
          return { ok: true, tool, output: `Supprimé: ${this.relative(target)}`, changedFiles: [this.relative(target)] };
        }
        case "terminal.run": {
          const cwd = this.resolveInside(str(args.cwd, "."));
          const result = await runSafeCommand(str(args.command), cwd, { shell: str(args.shell, "auto") as TerminalShell, timeoutMs: num(args.timeoutMs, 180_000) });
          return { ok: result.code === 0, tool, output: result.output, exitCode: result.code };
        }
        case "project.verify": {
          const result = await this.verifyProject(); return { ok: result.passed, tool, output: result, exitCode: result.passed ? 0 : 1 };
        }
        case "environment.inspect": return { ok: true, tool, output: await this.environment.inspect() };
        case "docker.inspect": return { ok: true, tool, output: await this.docker.inspect() };
        case "docker.run": {
          const command = Array.isArray(args.command) ? args.command.map(String) : [];
          const result = await this.docker.run(str(args.image), command, { cwd: this.workspace, timeoutMs: num(args.timeoutMs, 300_000) });
          return { ok: result.code === 0, tool, output: result, exitCode: result.code };
        }
        case "docker.compose": {
          const composeArgs = Array.isArray(args.args) ? args.args.map(String) : [];
          const result = await this.docker.compose(composeArgs, this.resolveInside(str(args.cwd, ".")), num(args.timeoutMs, 300_000));
          return { ok: result.code === 0, tool, output: result.output, exitCode: result.code };
        }
        case "browser.open": return { ok: true, tool, output: await this.browser.open(str(args.url)) };
        case "browser.click": return { ok: true, tool, output: await this.browser.click(str(args.selector)) };
        case "browser.fill": return { ok: true, tool, output: await this.browser.fill(str(args.selector), str(args.value)) };
        case "browser.press": return { ok: true, tool, output: await this.browser.press(str(args.selector), str(args.key, "Enter")) };
        case "browser.inspect": return { ok: true, tool, output: await this.browser.inspect() };
        case "browser.screenshot": {
          const target = this.resolveInside(str(args.path, path.join(".sophenic", "screenshots", `screen-${Date.now()}.png`)));
          return { ok: true, tool, output: await this.browser.screenshot(target, bool(args.fullPage, true)) };
        }
        case "web.search": return { ok: true, tool, output: await this.web.search(str(args.query), num(args.limit, 6)) };
        case "web.fetch": return { ok: true, tool, output: await this.web.fetch(str(args.url), num(args.maxChars, 18_000)) };
        case "image.generate": return await this.generateImage(args);
        case "github.status": return { ok: true, tool, output: await this.github.validate() };
        case "github.oauth_start": return { ok: true, tool, output: await this.github.startOAuthDeviceFlow() };
        case "github.oauth_poll": return { ok: true, tool, output: await this.github.pollOAuthDeviceFlow(str(args.deviceCode)) };
        case "github.search_repositories": return { ok: true, tool, output: await this.github.searchRepositories(str(args.query), num(args.limit, 8)) };
        case "github.search_code": return { ok: true, tool, output: await this.github.searchCode(str(args.query), num(args.limit, 8)) };
        case "github.create_repo": return { ok: true, tool, output: await this.github.createRepository(str(args.name), { description: str(args.description), private: bool(args.private, true) }) };
        case "github.commit": {
          const result = await this.github.commitAll(this.workspace, str(args.message, "SOPHENIC autonomous update"));
          return { ok: result.code === 0, tool, output: result.output, exitCode: result.code };
        }
        case "github.push": {
          const result = await this.github.push(this.workspace, str(args.remote, "origin"), str(args.branch));
          return { ok: result.code === 0, tool, output: result.output, exitCode: result.code };
        }
        case "vercel.status": return { ok: true, tool, output: await this.vercel.validate() };
        case "vercel.logs": {
          const result = await this.vercel.logs(str(args.deployment), num(args.limit, 120));
          return { ok: result.code === 0, tool, output: result.output, exitCode: result.code };
        }
        case "vercel.deploy": {
          const result = await this.vercel.deploy(this.workspace, { production: bool(args.production, true) });
          return { ok: result.code === 0, tool, output: result, exitCode: result.code };
        }
        default: throw new Error(`Outil Code inconnu: ${tool}`);
      }
    } catch (error) {
      return { ok: false, tool, output: error instanceof Error ? error.message : String(error) };
    }
  }

  async execute(tool: CodeToolName | string, rawArgs: unknown): Promise<CodeToolResult> {
    const args = obj(rawArgs);
    const result = await this.executeRaw(tool, args);
    this.logAction(tool, args, result);
    if (tool === "vercel.deploy" && result.ok) {
      try {
        const layout = ensureCodeWorkspaceLayout();
        const dir = path.join(layout.delivery, this.workspaceKey());
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${Date.now()}-vercel.json`), `${JSON.stringify({ at: new Date().toISOString(), workspace: this.workspace, result: result.output }, null, 2)}\n`, "utf8");
      } catch {}
    }
    return result;
  }

  async dispose(): Promise<void> { await this.browser.close().catch(() => undefined); }
}
