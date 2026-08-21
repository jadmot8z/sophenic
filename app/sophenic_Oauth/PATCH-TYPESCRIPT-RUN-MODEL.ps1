$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

$File = Join-Path $ProjectDir "src\components\agent\local-agent-workspace.tsx"
if (-not (Test-Path -LiteralPath $File)) {
    throw "Fichier introuvable : $File"
}

$Text = Get-Content -LiteralPath $File -Raw -Encoding UTF8

$OldPlanner = 'run: { ...(current.run || {}), agents: [{ role: "Planification", provider: planner.provider, model: planner.model }, ...(current.run?.agents || [{ role: "Construction", provider: activeProvider, model: activeModel }])] },'
$NewPlanner = 'run: { ...(current.run ?? { provider: activeProvider, model: activeModel }), agents: [{ role: "Planification", provider: planner.provider, model: planner.model }, ...(current.run?.agents || [{ role: "Construction", provider: activeProvider, model: activeModel }])] },'

$OldReviewer = 'run: { ...(current.run || {}), agents: [...(current.run?.agents || [{ role: "Construction", provider: activeProvider, model: activeModel }]), { role: "Relecture", provider: review.provider, model: review.model }] },'
$NewReviewer = 'run: { ...(current.run ?? { provider: activeProvider, model: activeModel }), agents: [...(current.run?.agents || [{ role: "Construction", provider: activeProvider, model: activeModel }]), { role: "Relecture", provider: review.provider, model: review.model }] },'

$Changed = $false
if ($Text.Contains($OldPlanner)) {
    $Text = $Text.Replace($OldPlanner, $NewPlanner)
    $Changed = $true
}
if ($Text.Contains($OldReviewer)) {
    $Text = $Text.Replace($OldReviewer, $NewReviewer)
    $Changed = $true
}

# The corrected ZIP already contains the fixed form. In that case this script is idempotent.
if ($Changed) {
    Set-Content -LiteralPath $File -Value $Text -Encoding UTF8 -NoNewline
    Write-Host "[OK] Les 2 erreurs ModelRun ont ete corrigees." -ForegroundColor Green
} elseif ($Text.Contains($NewPlanner) -and $Text.Contains($NewReviewer)) {
    Write-Host "[OK] Le correctif ModelRun est deja present." -ForegroundColor Green
} else {
    throw "Le code attendu n'a pas ete trouve. N'applique pas un remplacement approximatif."
}

Write-Host "Verification TypeScript..." -ForegroundColor Cyan
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Le typecheck signale encore une erreur." }

Write-Host "Tests Sophenic..." -ForegroundColor Cyan
npm run test:sophenic
if ($LASTEXITCODE -ne 0) { throw "Les tests Sophenic ont echoue." }

Write-Host "Lancement de Sophenic..." -ForegroundColor Green
npm run dev:desktop
