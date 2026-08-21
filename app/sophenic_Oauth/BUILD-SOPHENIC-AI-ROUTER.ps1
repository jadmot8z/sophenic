param(
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

function Test-IsAdministrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-DownloadsFolder {
    try {
        $Shell = New-Object -ComObject Shell.Application
        $Folder = $Shell.Namespace("shell:Downloads")
        if ($Folder -and $Folder.Self.Path) { return $Folder.Self.Path }
    } catch {}
    return (Join-Path $env:USERPROFILE "Downloads")
}

function Refresh-ProcessPath {
    $Machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $User = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = (@($Machine, $User, "C:\Program Files\nodejs") | Where-Object { $_ }) -join ";"
}

function Ensure-Node {
    Refresh-ProcessPath
    if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "[SOPHENIC] Node: $(node --version)" -ForegroundColor DarkGreen
        Write-Host "[SOPHENIC] npm : $(npm --version)" -ForegroundColor DarkGreen
        return
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Node.js est absent et winget n'est pas disponible. Installe Node.js LTS depuis nodejs.org puis relance ce script."
    }

    Write-Host "[SOPHENIC] Installation de Node.js LTS via winget..." -ForegroundColor Yellow
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "L'installation automatique de Node.js a échoué (code $LASTEXITCODE)." }
    Refresh-ProcessPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Node.js a été installé mais n'est pas encore visible. Ferme PowerShell, rouvre-le en administrateur et relance le script."
    }
}

if ($env:OS -ne "Windows_NT") { throw "Ce script doit être exécuté sous Windows." }

if (-not (Test-IsAdministrator)) {
    if ($Elevated) { throw "Impossible d'obtenir les droits administrateur." }
    Write-Host "[SOPHENIC] Une fenêtre UAC va s'ouvrir." -ForegroundColor Yellow
    $ThisScript = $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrWhiteSpace($ThisScript)) { throw "Enregistre d'abord ce script en fichier .ps1 puis relance-le." }
    $Args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $ThisScript + '"'), "-Elevated")
    $P = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($Args -join " ") -Wait -PassThru
    exit $P.ExitCode
}

$Downloads = Get-DownloadsFolder
$BuildDir = Join-Path $Downloads "SOPHENIC-5.4.0-AI-ROUTER-BUILD"
$FinalExe = Join-Path $Downloads "Sophenic Setup.exe"
$LogFile = Join-Path $Downloads "Sophenic-AI-Router-build.log"
$TranscriptStarted = $false

try {
    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host " SOPHENIC 5.4.0 AI ROUTER -> SOPHENIC SETUP.EXE" -ForegroundColor Cyan
    Write-Host "==============================================================" -ForegroundColor Cyan

    Ensure-Node

    $Zip = Get-ChildItem -LiteralPath $Downloads -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "SOPHENIC-V5.4.0-AI-ROUTER*.zip" -or $_.Name -like "SOPHENIC-V5.4.0-AGENTIC-THINKING-PRO*.zip" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $Zip) {
        throw "ZIP source introuvable dans Téléchargements. Télécharge SOPHENIC-V5.4.0-AI-ROUTER.zip puis relance."
    }

    Write-Host "[SOPHENIC] Source: $($Zip.FullName)" -ForegroundColor DarkGreen
    if (Test-Path -LiteralPath $BuildDir) { Remove-Item -LiteralPath $BuildDir -Recurse -Force }
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null

    Write-Host "[SOPHENIC] Extraction..." -ForegroundColor Yellow
    Expand-Archive -LiteralPath $Zip.FullName -DestinationPath $BuildDir -Force
    Get-ChildItem -LiteralPath $BuildDir -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        try { Unblock-File -LiteralPath $_.FullName -ErrorAction Stop } catch {}
    }

    $Package = Get-ChildItem -LiteralPath $BuildDir -Filter "package.json" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\node_modules\\" } |
        Where-Object {
            try {
                $Info = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
                return ([string]$Info.name -eq "sophenic" -and [string]$Info.version -eq "5.4.0")
            } catch { return $false }
        } |
        Select-Object -First 1

    if (-not $Package) { throw "Projet Sophenic 5.4.0 valide introuvable après extraction." }
    $ProjectRoot = $Package.Directory.FullName
    $BuildScript = Join-Path $ProjectRoot "build-sophenic.ps1"
    if (-not (Test-Path -LiteralPath $BuildScript)) { throw "build-sophenic.ps1 est absent du ZIP." }

    try {
        Start-Transcript -Path $LogFile -Force | Out-Null
        $TranscriptStarted = $true
    } catch {}

    Write-Host "[SOPHENIC] Projet: $ProjectRoot" -ForegroundColor DarkGreen
    Write-Host "[SOPHENIC] Les dépendances npm vont être téléchargées et vérifiées." -ForegroundColor Yellow
    Write-Host "[SOPHENIC] Le build exécute tests, TypeScript, Next.js, Electron et NSIS." -ForegroundColor Yellow

    Set-Location -LiteralPath $ProjectRoot
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$BuildScript" -ElevatedBuild
    if ($LASTEXITCODE -ne 0) { throw "Le build Sophenic a échoué (code $LASTEXITCODE). Consulte $LogFile." }

    if (-not (Test-Path -LiteralPath $FinalExe)) {
        $Generated = Get-ChildItem -LiteralPath $ProjectRoot -Filter "Sophenic Setup.exe" -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($Generated) { Copy-Item -LiteralPath $Generated.FullName -Destination $FinalExe -Force }
    }
    if (-not (Test-Path -LiteralPath $FinalExe)) { throw "Le build s'est terminé sans créer $FinalExe" }

    $Info = Get-Item -LiteralPath $FinalExe
    if ($Info.Length -lt 40MB) { throw "L'installateur semble incomplet: $([Math]::Round($Info.Length / 1MB, 1)) Mo." }
    $Hash = (Get-FileHash -LiteralPath $FinalExe -Algorithm SHA256).Hash

    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Green
    Write-Host " TERMINÉ - INSTALLATEUR CRÉÉ" -ForegroundColor Green
    Write-Host " $FinalExe" -ForegroundColor Green
    Write-Host " Taille : $([Math]::Round($Info.Length / 1MB, 1)) Mo" -ForegroundColor Green
    Write-Host " SHA256 : $Hash" -ForegroundColor DarkGreen
    Write-Host "==============================================================" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList "/select,`"$FinalExe`""
}
catch {
    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Red
    Write-Host " ERREUR BUILD SOPHENIC" -ForegroundColor Red
    Write-Host "==============================================================" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Journal: $LogFile" -ForegroundColor Yellow
    exit 1
}
finally {
    if ($TranscriptStarted) { try { Stop-Transcript | Out-Null } catch {} }
}
