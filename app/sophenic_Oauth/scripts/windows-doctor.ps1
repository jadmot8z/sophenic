$ErrorActionPreference = "SilentlyContinue"
function Section($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }
function Probe($name, $command, $args, $required = $false) {
  $cmd = Get-Command $command -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Host ("{0,-12}: absent{1}" -f $name, $(if ($required) { " (requis)" } else { " (optionnel)" })) -ForegroundColor $(if ($required) { "Red" } else { "Yellow" })
    return $false
  }
  $out = & $command @args 2>&1 | Select-Object -First 1
  Write-Host ("{0,-12}: {1}" -f $name, $out) -ForegroundColor Green
  return $true
}

Write-Host "Sophenic 6.0 Windows Doctor" -ForegroundColor White
Write-Host "Diagnostic local non destructif. Hermes est optionnel pour Sophenic Code." -ForegroundColor DarkGray

Section "Windows"
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
Write-Host ("OS          : {0} {1} (build {2})" -f $os.Caption, $os.OSArchitecture, $os.BuildNumber)
Write-Host ("RAM         : {0} GB" -f [math]::Round($cs.TotalPhysicalMemory / 1GB, 1))

Section "Toolchain"
$node = Probe "Node.js" "node" @("--version") $true
$npm = Probe "npm" "npm" @("--version") $true
$git = Probe "Git" "git" @("--version") $true
$python = Probe "Python" "python" @("--version") $false
$docker = Probe "Docker" "docker" @("--version") $false
if ($npm) { Probe "Playwright" "npx" @("playwright", "--version") $false | Out-Null }

Section "Modèles locaux"
Probe "Ollama" "ollama" @("--version") $false | Out-Null
if (Get-Command ollama -ErrorAction SilentlyContinue) { & ollama list 2>$null }

Section "Hermes optionnel"
if (-not (Probe "Hermes" "hermes" @("--version") $false)) {
  $managed = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\venv\Scripts\hermes.exe"
  if (Test-Path $managed) { Write-Host ("Hermes géré : " + ((& $managed --version 2>$null) -join ' ')) -ForegroundColor Green }
  else { Write-Host "Aucun Hermes détecté : Sophenic Code reste fonctionnel via son moteur natif." -ForegroundColor DarkGray }
}

Section "Docker daemon"
if ($docker) {
  & docker info --format "Docker daemon: {{.ServerVersion}}" 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host "Docker CLI présent mais Docker Desktop/daemon n'est pas démarré." -ForegroundColor Yellow }
}

Section "Résumé"
if ($node -and $npm -and $git) { Write-Host "Base de développement prête." -ForegroundColor Green }
else { Write-Host "Des prérequis requis manquent. Lance RUN-SOPHENIC-VSCODE.ps1 pour proposer leur installation." -ForegroundColor Red }
