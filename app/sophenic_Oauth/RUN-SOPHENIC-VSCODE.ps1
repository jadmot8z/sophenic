$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Header($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Offer-Winget($label, $id) {
  if (-not (Has "winget")) { Write-Host "$label absent. Installe-le manuellement puis relance ce script." -ForegroundColor Yellow; return }
  $answer = Read-Host "$label est absent. L'installer automatiquement avec winget ? (O/N)"
  if ($answer -match '^(o|oui|y|yes)$') {
    & winget install --id $id -e --accept-package-agreements --accept-source-agreements
  }
}

Write-Host "SOPHENIC CODE ENGINE 6.0 — VS Code launcher" -ForegroundColor White
Write-Host "Hermes est optionnel pour Code. Sophenic Brain pilote directement le modèle et le Code Engine natif." -ForegroundColor DarkGray

Header "Prérequis"
if (-not (Has "node")) { Offer-Winget "Node.js LTS" "OpenJS.NodeJS.LTS" }
if (-not (Has "git")) { Offer-Winget "Git" "Git.Git" }
if (-not (Has "python")) { Offer-Winget "Python" "Python.Python.3.13" }
if (-not (Has "docker")) { Offer-Winget "Docker Desktop" "Docker.DockerDesktop" }
if (-not (Has "code")) { Offer-Winget "Visual Studio Code" "Microsoft.VisualStudioCode" }

if (-not (Has "node")) { throw "Node.js est requis. Si winget vient de l'installer, ferme/réouvre PowerShell puis relance ce script." }
if (-not (Has "npm")) { throw "npm est requis et doit être installé avec Node.js." }

Write-Host ("Node       : " + (& node --version)) -ForegroundColor Green
Write-Host ("npm        : " + (& npm --version)) -ForegroundColor Green
Write-Host ("Git        : " + ($(if (Has "git") { (& git --version) } else { "optionnel/non détecté" })))
Write-Host ("Python     : " + ($(if (Has "python") { (& python --version 2>&1) } else { "optionnel/non détecté" })))
Write-Host ("Docker     : " + ($(if (Has "docker") { (& docker --version 2>&1) } else { "optionnel/non détecté" })))
Write-Host ("Playwright : vérifié après npm install")

Header "Configuration locale"
if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env créé depuis .env.example (aucun secret réel inclus)." -ForegroundColor Green
}

Header "Dépendances"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install a échoué." }

$pwRoot = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $pwRoot)) {
  $answer = Read-Host "Chromium Playwright n'est pas détecté. L'installer maintenant ? (O/N)"
  if ($answer -match '^(o|oui|y|yes)$') {
    & npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { Write-Host "Installation Chromium Playwright incomplète. Le Code Engine pourra réessayer plus tard." -ForegroundColor Yellow }
  }
}

Header "Diagnostic Sophenic"
& npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Le typecheck a échoué. Corrige le projet avant lancement." }

if (Has "code") {
  & code .
} else {
  Write-Host "Commande 'code' indisponible. Ouvre ce dossier manuellement dans Visual Studio Code." -ForegroundColor Yellow
}

Header "Lancement Desktop"
Write-Host "Démarrage de Next.js + Electron..." -ForegroundColor Green
& npm run dev:desktop
