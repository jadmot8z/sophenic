$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

function Test-IsAdministrator {
    $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
    return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$TranscriptStarted = $false

try {
    if ($env:OS -ne "Windows_NT") {
        throw "Ce script doit être exécuté sous Windows."
    }

    if (-not (Test-IsAdministrator)) {
        throw "Ouvre PowerShell avec 'Exécuter en tant qu’administrateur', puis relance ce script."
    }

    $Downloads = Join-Path $env:USERPROFILE "Downloads"
    $ZipPattern = "SOPHENIC-V5.4.0-AGENTIC-THINKING-PRO*.zip"
    $BuildDir = Join-Path $Downloads "SOPHENIC-5.4.0-BUILD"
    $FinalExe = Join-Path $Downloads "Sophenic Setup.exe"
    $LogFile = Join-Path $Downloads "Sophenic-build-5.4.0.log"

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " SOPHENIC 5.4.0 -> SOPHENIC SETUP.EXE" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    $Zip = Get-ChildItem -LiteralPath $Downloads -File -Filter $ZipPattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $Zip) {
        throw "ZIP introuvable dans Téléchargements. Nom attendu: $ZipPattern"
    }

    Write-Host "[SOPHENIC] ZIP: $($Zip.FullName)" -ForegroundColor DarkGreen

    if (Test-Path -LiteralPath $BuildDir) {
        Remove-Item -LiteralPath $BuildDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null

    Write-Host "[SOPHENIC] Extraction propre..." -ForegroundColor Yellow
    Expand-Archive -LiteralPath $Zip.FullName -DestinationPath $BuildDir -Force

    Write-Host "[SOPHENIC] Déblocage des fichiers téléchargés..." -ForegroundColor Yellow
    Get-ChildItem -LiteralPath $BuildDir -File -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
            try { Unblock-File -LiteralPath $_.FullName -ErrorAction Stop } catch {}
        }

    $Packages = Get-ChildItem -LiteralPath $BuildDir -Filter "package.json" -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\node_modules\\" }

    $Package = $null
    foreach ($Candidate in $Packages) {
        try {
            $Info = Get-Content -LiteralPath $Candidate.FullName -Raw | ConvertFrom-Json
            if ([string]$Info.name -eq "sophenic" -and [string]$Info.version -eq "5.4.0") {
                $Package = $Candidate
                break
            }
        } catch {}
    }

    if (-not $Package) {
        throw "Source SOPHENIC 5.4.0 valide introuvable après extraction."
    }

    $ProjectRoot = $Package.Directory.FullName
    $BuildScript = Join-Path $ProjectRoot "build-sophenic.ps1"
    if (-not (Test-Path -LiteralPath $BuildScript)) {
        $FoundScripts = Get-ChildItem -LiteralPath $BuildDir -Filter "build-sophenic.ps1" -File -Recurse -ErrorAction SilentlyContinue |
            ForEach-Object { $_.FullName }
        throw "build-sophenic.ps1 est absent après extraction. Scripts trouvés: $($FoundScripts -join '; ')"
    }

    $BuildScriptInfo = Get-Item -LiteralPath $BuildScript
    if ($BuildScriptInfo.Length -lt 1000) {
        throw "build-sophenic.ps1 semble incomplet ($($BuildScriptInfo.Length) octets)."
    }

    if (Test-Path -LiteralPath $FinalExe) {
        Remove-Item -LiteralPath $FinalExe -Force
    }

    try {
        Start-Transcript -Path $LogFile -Force | Out-Null
        $TranscriptStarted = $true
    } catch {}

    Write-Host "[SOPHENIC] Projet: $ProjectRoot" -ForegroundColor DarkGreen
    Write-Host "[SOPHENIC] Build script: $BuildScript" -ForegroundColor DarkGreen
    Write-Host "[SOPHENIC] Journal: $LogFile" -ForegroundColor DarkGreen
    Write-Host "[SOPHENIC] Lancement des tests + Next.js + Electron + NSIS..." -ForegroundColor Yellow

    Set-Location -LiteralPath $ProjectRoot
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$BuildScript" -ElevatedBuild
    $BuildCode = $LASTEXITCODE
    if ($BuildCode -ne 0) {
        throw "Le build SOPHENIC a échoué (code $BuildCode). Consulte $LogFile."
    }

    if (-not (Test-Path -LiteralPath $FinalExe)) {
        $GeneratedExe = Get-ChildItem -LiteralPath $ProjectRoot -Filter "Sophenic Setup.exe" -File -Recurse -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if ($GeneratedExe) {
            Copy-Item -LiteralPath $GeneratedExe.FullName -Destination $FinalExe -Force
        }
    }

    if (-not (Test-Path -LiteralPath $FinalExe)) {
        throw "Le build s'est terminé sans créer $FinalExe"
    }

    $Info = Get-Item -LiteralPath $FinalExe
    if ($Info.Length -lt 40000000) {
        throw "L'installateur semble incomplet: $([Math]::Round($Info.Length / 1MB, 1)) Mo."
    }

    $Stream = [System.IO.File]::OpenRead($FinalExe)
    try {
        $B0 = $Stream.ReadByte()
        $B1 = $Stream.ReadByte()
        if ($B0 -ne 0x4D -or $B1 -ne 0x5A) {
            throw "Le fichier final n'est pas un exécutable Windows PE valide."
        }
    } finally {
        $Stream.Dispose()
    }

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host " TERMINÉ" -ForegroundColor Green
    Write-Host " $FinalExe" -ForegroundColor Green
    Write-Host " Taille: $([Math]::Round($Info.Length / 1MB, 1)) Mo" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList "/select,`"$FinalExe`""
}
catch {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host " ERREUR SOPHENIC" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    throw
}
finally {
    if ($TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
}
