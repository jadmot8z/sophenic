$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "" 
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " SOPHENIC 5.4.3 - PATCH HUGGING FACE IMAGE TYPECHECK" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$File = Join-Path $PSScriptRoot "electron\runtime\image-router.ts"
if (-not (Test-Path -LiteralPath $File)) {
    throw "electron\runtime\image-router.ts introuvable. Place ce script a la racine de SOPHENIC."
}

$Content = Get-Content -LiteralPath $File -Raw
$Old = @'
        const blob = await client.textToImage({
          provider: "auto",
          model,
          inputs: input.prompt,
          parameters: dimensions
        });
'@
$New = @'
        const blob = await client.textToImage({
          provider: "auto",
          model,
          inputs: input.prompt,
          parameters: dimensions
        }, {
          outputType: "blob",
          signal: input.signal
        });
'@

if ($Content.Contains('outputType: "blob"')) {
    Write-Host "[OK] Le patch Hugging Face est deja applique." -ForegroundColor Green
}
elseif ($Content.Contains($Old)) {
    $Content = $Content.Replace($Old, $New)
    Set-Content -LiteralPath $File -Value $Content -Encoding UTF8
    Write-Host "[OK] Patch applique a image-router.ts." -ForegroundColor Green
}
else {
    throw "Le bloc Hugging Face attendu n'a pas ete trouve. N'applique pas un remplacement aveugle."
}

Write-Host ""
Write-Host "[1/3] TypeScript..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "typecheck a echoue." }

Write-Host ""
Write-Host "[2/3] Tests SOPHENIC..." -ForegroundColor Yellow
npm run test:sophenic
if ($LASTEXITCODE -ne 0) { throw "Les tests SOPHENIC ont echoue." }

Write-Host ""
Write-Host "[3/3] Lancement SOPHENIC..." -ForegroundColor Green
npm run dev:desktop
