$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Write-Host "=== SOPHENIC 5.4.0 - DEV FIX + LAUNCH ===" -ForegroundColor Cyan
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "Node.js est introuvable." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm est introuvable." }

Write-Host "Node: $(node --version)"
Write-Host "npm : $(npm --version)"

# Electron doit exécuter son script postinstall pour télécharger electron.exe.
npm config set ignore-scripts false --location=project

if (-not (Test-Path "node_modules")) {
  Write-Host "Installation des dependances..." -ForegroundColor Yellow
  npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install a echoue." }
}

$ElectronExe = Join-Path $PSScriptRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $ElectronExe)) {
  Write-Host "Electron est incomplet. Reinstallation d'Electron 37.2.6..." -ForegroundColor Yellow
  Remove-Item -LiteralPath (Join-Path $PSScriptRoot "node_modules\electron") -Recurse -Force -ErrorAction SilentlyContinue
  npm install --save-dev electron@37.2.6 --force --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "La reinstallation d'Electron a echoue." }
}

if (-not (Test-Path -LiteralPath $ElectronExe)) {
  throw "electron.exe est toujours absent apres reinstallation. Verifie antivirus/proxy/VPN ou acces a GitHub releases."
}

Write-Host "Electron OK: $ElectronExe" -ForegroundColor Green

Write-Host "Verification TypeScript..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Le typecheck echoue encore." }

Write-Host "Tests Sophenic..." -ForegroundColor Yellow
npm run test:sophenic
if ($LASTEXITCODE -ne 0) { throw "Les tests Sophenic ont echoue." }

Write-Host "Lancement de SOPHENIC sans creer d'installateur EXE..." -ForegroundColor Green
npm run dev:desktop
