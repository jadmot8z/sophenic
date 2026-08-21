import { spawn } from "node:child_process";
import path from "node:path";
import { applyBaseDefaults, inspectEngineConfig, seedEngineDefaults } from "./config";
import { resolveHermes } from "./hermes";

let installing: Promise<void> | null = null;

export async function ensureEngineInstalled(): Promise<void> {
  if (resolveHermes().candidate) {
    applyBaseDefaults();
    return;
  }
  if (process.platform !== "win32") throw new Error("Installation automatique disponible uniquement sous Windows.");
  if (installing) return installing;

  installing = new Promise<void>((resolve, reject) => {
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    // Download to a real .ps1 file instead of ScriptBlock::Create so Windows
    // PowerShell 5.1 is not sensitive to a BOM in the downloaded payload.
    const script = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      "$source='https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1'",
      "$tmp=Join-Path $env:TEMP ('sophenic-ai-'+[Guid]::NewGuid().ToString('N')+'.ps1')",
      "try { Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $tmp; & $tmp -SkipSetup; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }"
    ].join("; ");
    const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `L'installation du moteur IA a échoué (code ${code ?? "?"}).`));
        return;
      }
      // The official installer updates User PATH for new terminals, while this
      // Electron process discovers the executable directly under LOCALAPPDATA.
      if (!resolveHermes().candidate) {
        reject(new Error("Le moteur IA a été téléchargé mais son exécutable n'a pas été détecté."));
        return;
      }
      try {
        // This branch is only reached for a fresh install initiated by Sophenic,
        // so it is safe to seed the requested OpenRouter default globally. A
        // pre-existing CLI installation is preserved by the early branch above.
        seedEngineDefaults();
        resolve();
      } catch (error) { reject(error); }
    });
  }).finally(() => { installing = null; });

  return installing;
}

export function engineSetupStatus() {
  const config = inspectEngineConfig();
  return {
    installed: config.installed,
    // Chat no longer depends on OpenRouter specifically. Hermes remains
    // optional for PC/Code actions; any configured cloud provider can power
    // the normal Sophenic Brain chat immediately.
    readyForChat: config.aiProviderCount > 0 || (config.installed && config.openRouterKeyConfigured),
    provider: config.provider,
    model: config.model,
    openRouterKeyConfigured: config.openRouterKeyConfigured,
    aiProviderCount: config.aiProviderCount,
    configuredProviders: config.configuredProviders,
    version: config.version
  };
}
