param(
    [switch]$ElevatedBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$ProgressPreference = "SilentlyContinue"

$ScriptFile = $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    Write-Host "ERREUR: exécute build-sophenic.ps1 comme fichier, ne colle pas son contenu ligne par ligne." -ForegroundColor Red
    exit 100
}

$ProjectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
Set-Location -LiteralPath $ProjectRoot
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

function Write-Step([string]$Message) {
    Write-Host "[SOPHENIC] $Message" -ForegroundColor Cyan
}

function Test-IsAdministrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-SymlinkPrivilege {
    $Root = Join-Path $env:TEMP ("sophenic-symlink-" + [Guid]::NewGuid().ToString("N"))
    try {
        New-Item -ItemType Directory -Path $Root -Force | Out-Null
        $Target = Join-Path $Root "target.txt"
        $Link = Join-Path $Root "link.txt"
        Set-Content -LiteralPath $Target -Value "SOPHENIC" -Encoding ASCII
        New-Item -ItemType SymbolicLink -Path $Link -Target $Target -Force -ErrorAction Stop | Out-Null
        return (Test-Path -LiteralPath $Link)
    } catch {
        return $false
    } finally {
        Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "Ce script construit l'installateur Windows et doit être exécuté sous Windows."
}

# electron-builder/winCodeSign extracts symlinks. Developer Mode permits this
# without elevation; otherwise relaunch only the build process as administrator.
if (-not (Test-IsAdministrator) -and -not (Test-SymlinkPrivilege)) {
    if ($ElevatedBuild) { throw "Windows refuse les liens symboliques malgré l'élévation." }
    Write-Host "[SOPHENIC] Autorisation Windows requise pour electron-builder. Accepte la fenêtre UAC." -ForegroundColor Yellow
    $Args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $ScriptFile + '"'), "-ElevatedBuild")
    $Elevated = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList ($Args -join " ") -WorkingDirectory $ProjectRoot -Wait -PassThru
    exit $Elevated.ExitCode
}

foreach ($Marker in @("package.json", "electron-builder.yml", "next.config.js", "electron\main.js", "electron\main.ts")) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $Marker))) {
        throw "Projet SOPHENIC incomplet: $Marker est absent."
    }
}

$ExpectedVersion = "5.4.0"
$PackageInfo = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ([string]$PackageInfo.version -ne $ExpectedVersion) {
    throw "Mauvaise version SOPHENIC: $($PackageInfo.version). Version attendue: $ExpectedVersion."
}
Write-Host "[SOPHENIC] Version source $ExpectedVersion : OK" -ForegroundColor DarkGreen

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js est introuvable." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm est introuvable." }

function Invoke-Npm([string[]]$Arguments, [string]$Label) {
    Write-Step $Label
    Write-Host ("> npm " + ($Arguments -join " ")) -ForegroundColor DarkGray
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label a échoué (code $LASTEXITCODE)." }
}

function Remove-TreeIfExists([string]$Path) {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

function Get-DownloadsFolder {
    try {
        $Shell = New-Object -ComObject Shell.Application
        $Folder = $Shell.Namespace("shell:Downloads")
        if ($Folder -and $Folder.Self.Path) { return $Folder.Self.Path }
    } catch {}
    return (Join-Path $env:USERPROFILE "Downloads")
}

function Stop-SophenicProcesses {
    Get-Process -Name "SOPHENIC" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
}

function Test-SophenicRuntime([string]$Exe, [string]$WorkingDirectory, [string]$Label) {
    Write-Step $Label
    $Marker = Join-Path $env:TEMP ("sophenic-ready-" + [Guid]::NewGuid().ToString("N") + ".json")
    Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
    $Process = Start-Process -FilePath $Exe -WorkingDirectory $WorkingDirectory -ArgumentList ('"--sophenic-smoke-ready={0}"' -f $Marker) -PassThru
    try {
        $Deadline = (Get-Date).AddSeconds(55)
        while ((Get-Date) -lt $Deadline) {
            Start-Sleep -Milliseconds 500
            $Process.Refresh()
            if ($Process.HasExited) { throw "${Label}: SOPHENIC s'est arrêté prématurément (code $($Process.ExitCode))." }
            if (Test-Path -LiteralPath $Marker) { break }
        }
        if (-not (Test-Path -LiteralPath $Marker)) { throw "${Label}: la fenêtre principale n'a jamais signalé qu'elle était prête." }
        $Process.Refresh()
        if ($Process.MainWindowHandle -eq 0) { throw "${Label}: le processus tourne mais aucune vraie fenêtre Windows n'est visible." }
        Write-Host "[SOPHENIC] Fenêtre principale visible : OK" -ForegroundColor DarkGreen
    } finally {
        try {
            $Process.Refresh()
            if (-not $Process.HasExited) {
                $null = $Process.CloseMainWindow()
                if (-not $Process.WaitForExit(8000)) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
            }
        } catch { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $Marker -Force -ErrorAction SilentlyContinue
        Stop-SophenicProcesses
    }
}

function Assert-NoDebugLog([string]$Directory, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    $Logs = Get-ChildItem -LiteralPath $Directory -Filter "debug.log" -File -Recurse -ErrorAction SilentlyContinue
    if ($Logs) { throw "${Label}: debug.log détecté: $($Logs[0].FullName)" }
}

function Find-SophenicUninstallEntry {
    $Roots = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )
    foreach ($Root in $Roots) {
        if (-not (Test-Path $Root)) { continue }
        foreach ($Key in Get-ChildItem $Root -ErrorAction SilentlyContinue) {
            $Info = Get-ItemProperty $Key.PSPath -ErrorAction SilentlyContinue
            if ($Info) {
                $DisplayProperty = $Info.PSObject.Properties["DisplayName"]
                if ($DisplayProperty -and ([string]$DisplayProperty.Value) -like "SOPHENIC*") { return $Info }
            }
        }
    }
    return $null
}

$Downloads = Get-DownloadsFolder
$FinalExe = Join-Path $Downloads "Sophenic Setup.exe"
$Release = Join-Path $ProjectRoot "release"
$Unpacked = Join-Path $Release "win-unpacked"
$UnpackedExe = Join-Path $Unpacked "SOPHENIC.exe"
New-Item -ItemType Directory -Path $Downloads -Force | Out-Null
Stop-SophenicProcesses
if (Test-Path -LiteralPath $FinalExe) { Remove-Item -LiteralPath $FinalExe -Force }

Write-Step "Nettoyage des anciens builds"
@(".next", "dist-electron", "dist-desktop", "dist-web", "release", ".turbo") | ForEach-Object {
    Remove-TreeIfExists (Join-Path $ProjectRoot $_)
}

foreach ($Required in @(
    "build\icon.ico",
    "build\installerSidebar.bmp",
    "build\installerHeader.bmp",
    "build\installer.nsh",
    "build\launch\splash.html",
    "build\launch\intro.mp4",
    "scripts\normalize-standalone.mjs"
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $Required))) { throw "Fichier obligatoire manquant: $Required" }
}

if ($env:SOPHENIC_SKIP_NPM_INSTALL -eq "1" -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
    Write-Step "Réutilisation des dépendances déjà installées"
} else {
    Invoke-Npm @("install", "--no-audit", "--no-fund") "Installation / correction des dépendances"
}

function Assert-NodePackageVersion([string]$PackageName, [string]$ExpectedVersion) {
    $PackageJson = Join-Path $ProjectRoot ("node_modules\{0}\package.json" -f $PackageName)
    if (-not (Test-Path -LiteralPath $PackageJson)) { throw "Dépendance introuvable après npm install: $PackageName" }
    $PackageInfo = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
    if ([string]$PackageInfo.version -ne $ExpectedVersion) {
        throw "Version incompatible pour ${PackageName}: $($PackageInfo.version). Version requise: $ExpectedVersion."
    }
    Write-Host "[SOPHENIC] $PackageName $ExpectedVersion : OK" -ForegroundColor DarkGreen
}

Write-Step "Vérification des dépendances critiques"
Assert-NodePackageVersion "next" "15.5.21"
Assert-NodePackageVersion "electron" "37.2.6"
Assert-NodePackageVersion "electron-builder" "26.0.12"
Assert-NodePackageVersion "framer-motion" "12.23.24"
Assert-NodePackageVersion "motion-dom" "12.23.23"
Assert-NodePackageVersion "motion-utils" "12.23.6"
Invoke-Npm @("run", "verify:source") "Vérification des sources"
Invoke-Npm @("run", "test:sophenic") "Tests applicatifs"
Invoke-Npm @("run", "typecheck") "TypeScript"
Invoke-Npm @("run", "build:web") "Build Next.js"
Invoke-Npm @("run", "normalize:standalone") "Normalisation Next.js standalone"

$StandaloneServer = Join-Path $ProjectRoot ".next\standalone\server.js"
if (-not (Test-Path -LiteralPath $StandaloneServer)) { throw ".next\standalone\server.js n'a pas été produit." }

Invoke-Npm @("run", "build:electron") "Build Electron"
Invoke-Npm @("run", "desktop:verify") "Vérification du main process / preload"
Invoke-Npm @("run", "prepare:desktop") "Préparation ASAR + runtime Next"

# Remove a potentially corrupt electron-builder code-signing cache from an old attempt.
$WinCodeSignCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\winCodeSign"
if (Test-Path -LiteralPath $WinCodeSignCache) {
    Write-Step "Nettoyage du cache winCodeSign"
    Remove-Item -LiteralPath $WinCodeSignCache -Recurse -Force -ErrorAction SilentlyContinue
}

Invoke-Npm @("run", "package:win:installer") "Création de l'installateur NSIS"
Invoke-Npm @("run", "verify:package") "Vérification du package Windows / ICU / Chromium"

$BuiltInstaller = Join-Path $Release "Sophenic Setup.exe"
if (-not (Test-Path -LiteralPath $BuiltInstaller)) { throw "Sophenic Setup.exe n'a pas été généré." }
if (-not (Test-Path -LiteralPath $UnpackedExe)) { throw "win-unpacked\SOPHENIC.exe est absent." }

# TEST 1: assisted installer branding and the requested Installer button.
Write-Step "TEST 1 - installateur SOPHENIC assisté"
$BuilderConfig = Get-Content -LiteralPath (Join-Path $ProjectRoot "electron-builder.yml") -Raw
$InstallerNsh = Get-Content -LiteralPath (Join-Path $ProjectRoot "build\installer.nsh") -Raw
foreach ($Expected in @("oneClick: false", "createDesktopShortcut: always", "createStartMenuShortcut: true", "uninstallDisplayName: SOPHENIC", 'artifactName: "Sophenic Setup.${ext}"')) {
    if (-not $BuilderConfig.Contains($Expected)) { throw "TEST 1/2: configuration NSIS absente: $Expected" }
}
if (-not $InstallerNsh.Contains('MUI_WELCOMEPAGE_TITLE "SOPHENIC INSTALLER"')) { throw "TEST 1: titre SOPHENIC INSTALLER absent." }
if (-not $InstallerNsh.Contains('STR:Installer')) { throw "TEST 1: bouton Installer absent." }
if ($BuilderConfig -match '(?i)portable') { throw "TEST 1: une cible portable est interdite." }

# TEST 3/4/6 on the exact unpacked payload that NSIS embeds.
Test-SophenicRuntime $UnpackedExe $Unpacked "TEST 3 - lancement du package"
Test-SophenicRuntime $UnpackedExe $Unpacked "TEST 4 - fermeture / réouverture"
if (-not (Test-Path -LiteralPath (Join-Path $Unpacked "icudtl.dat"))) { throw "TEST 6: icudtl.dat absent." }
if (-not (Test-Path -LiteralPath (Join-Path $Unpacked "resources.pak"))) { throw "TEST 6: resources.pak absent." }
Assert-NoDebugLog $Unpacked "TEST 5"

# TEST 2 + installed runtime round-trip. Do not overwrite an existing real install.
$ExistingInstall = Find-SophenicUninstallEntry
if ($ExistingInstall) {
    Write-Host "[SOPHENIC] Installation SOPHENIC déjà présente: test NSIS réel non destructif ignoré; le package unpacked a été testé." -ForegroundColor Yellow
} else {
    Write-Step "TEST 2 - installation NSIS réelle et raccourcis"
    $InstalledDir = $null
    try {
        $InstallProcess = Start-Process -FilePath $BuiltInstaller -ArgumentList "/S" -Wait -PassThru
        if ($InstallProcess.ExitCode -ne 0) { throw "TEST 2: l'installateur silencieux a retourné $($InstallProcess.ExitCode)." }
        Start-Sleep -Seconds 2
        Stop-SophenicProcesses

        $DesktopLink = Join-Path ([Environment]::GetFolderPath("Desktop")) "SOPHENIC.lnk"
        $StartLink = Join-Path ([Environment]::GetFolderPath("Programs")) "SOPHENIC.lnk"
        if (-not (Test-Path -LiteralPath $DesktopLink)) { throw "TEST 2: raccourci Bureau SOPHENIC absent." }
        if (-not (Test-Path -LiteralPath $StartLink)) { throw "TEST 2: raccourci Menu Démarrer SOPHENIC absent." }

        $Wsh = New-Object -ComObject WScript.Shell
        $InstalledExe = $Wsh.CreateShortcut($DesktopLink).TargetPath
        if ([string]::IsNullOrWhiteSpace($InstalledExe) -or -not (Test-Path -LiteralPath $InstalledExe)) { throw "TEST 2: cible du raccourci Bureau invalide." }
        $InstalledDir = Split-Path -Parent $InstalledExe
        if (-not (Find-SophenicUninstallEntry)) { throw "TEST 2: entrée Désinstaller SOPHENIC absente des Applications Windows." }

        Test-SophenicRuntime $InstalledExe $InstalledDir "TEST 3 - lancement après installation"
        Test-SophenicRuntime $InstalledExe $InstalledDir "TEST 4 - réouverture après installation"
        Assert-NoDebugLog $InstalledDir "TEST 5"
        if (-not (Test-Path -LiteralPath (Join-Path $InstalledDir "icudtl.dat"))) { throw "TEST 6: ICU absent de l'installation." }
    } finally {
        Stop-SophenicProcesses
        if ($InstalledDir -and (Test-Path -LiteralPath $InstalledDir)) {
            $Uninstaller = Get-ChildItem -LiteralPath $InstalledDir -Filter "Uninstall*.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($Uninstaller) {
                Start-Process -FilePath $Uninstaller.FullName -ArgumentList "/S" -Wait | Out-Null
                Start-Sleep -Seconds 2
            }
        }
    }
}

Assert-NoDebugLog $Release "TEST 5"

Copy-Item -LiteralPath $BuiltInstaller -Destination $FinalExe -Force
$Result = Get-Item -LiteralPath $FinalExe
if ($Result.Length -lt 40000000) { throw "Sophenic Setup.exe semble incomplet ($($Result.Length) octets)." }
$Stream = [System.IO.File]::OpenRead($FinalExe)
try {
    $B0 = $Stream.ReadByte(); $B1 = $Stream.ReadByte()
    if ($B0 -ne 0x4D -or $B1 -ne 0x5A) { throw "Sophenic Setup.exe n'est pas un exécutable Windows PE valide." }
} finally { $Stream.Dispose() }

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host " SOPHENIC INSTALLER PRÊT" -ForegroundColor Green
Write-Host " $FinalExe" -ForegroundColor Green
Write-Host "==============================================================" -ForegroundColor Green
Start-Process explorer.exe -ArgumentList "/select,`"$FinalExe`""
