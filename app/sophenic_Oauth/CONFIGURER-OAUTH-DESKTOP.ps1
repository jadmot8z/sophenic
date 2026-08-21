$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

try { chcp 65001 > $null } catch {}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$envPath = Join-Path $PSScriptRoot ".env.local"
$defaultGithubClientId = "Ov23livNj43OaKhQspRt"
$defaultPort = "43821"

function Read-PlainSecret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $lines = @()
  if (Test-Path $envPath) { $lines = @(Get-Content $envPath -Encoding UTF8) }
  $pattern = "^" + [Regex]::Escape($Name) + "="
  $updated = $false
  $result = foreach ($line in $lines) {
    if ($line -match $pattern) {
      if (-not $updated) { "$Name=$Value"; $updated = $true }
    } else { $line }
  }
  if (-not $updated) { $result += "$Name=$Value" }
  [IO.File]::WriteAllLines($envPath, [string[]]$result, [Text.UTF8Encoding]::new($false))
}

function Remove-EnvValue([string]$Name) {
  if (-not (Test-Path $envPath)) { return }
  $pattern = "^" + [Regex]::Escape($Name) + "="
  $result = @(Get-Content $envPath -Encoding UTF8 | Where-Object { $_ -notmatch $pattern })
  [IO.File]::WriteAllLines($envPath, [string[]]$result, [Text.UTF8Encoding]::new($false))
}

Write-Host ""
Write-Host "SOPHENIC Desktop - Configuration GitHub + Vercel" -ForegroundColor Cyan
Write-Host "Les secrets sont écrits uniquement dans .env.local (ignoré par Git)." -ForegroundColor DarkGray
Write-Host ""

$githubClientId = Read-Host "GitHub Client ID [$defaultGithubClientId]"
if ([string]::IsNullOrWhiteSpace($githubClientId)) { $githubClientId = $defaultGithubClientId }
$githubClientId = $githubClientId.Trim()
if ($githubClientId -notmatch '^[A-Za-z0-9_]{10,200}$') {
  throw "GitHub Client ID invalide. Ne colle pas une commande npm ici. Utilise uniquement le Client ID GitHub, par exemple Ov23..."
}

$githubSecret = Read-PlainSecret "GitHub Client Secret COMPLET (saisie masquée)"
if ([string]::IsNullOrWhiteSpace($githubSecret)) { throw "Le GitHub Client Secret complet est obligatoire." }

Set-EnvValue "SOPHENIC_GITHUB_CLIENT_ID" $githubClientId
Set-EnvValue "SOPHENIC_GITHUB_CLIENT_SECRET" $githubSecret.Trim()
Set-EnvValue "SOPHENIC_GITHUB_OAUTH_SCOPES" "read:user user:email repo"
Set-EnvValue "SOPHENIC_OAUTH_LOOPBACK_PORT" $defaultPort

Write-Host ""
Write-Host "GitHub configuré." -ForegroundColor Green
Write-Host "Redirect URI GitHub à enregistrer exactement :" -ForegroundColor Yellow
Write-Host "http://127.0.0.1:$defaultPort/oauth/github/callback" -ForegroundColor White
Write-Host ""

$configureVercel = Read-Host "Configurer Vercel avec un Personal Access Token (vcp_...) ? (o/N)"
if ($configureVercel -match '^(o|oui|y|yes)$') {
  $vercelToken = Read-PlainSecret "Vercel Personal Access Token (saisie masquée)"
  if ([string]::IsNullOrWhiteSpace($vercelToken)) { throw "Le token Vercel est obligatoire." }
  $vercelToken = $vercelToken.Trim()
  if ($vercelToken.Length -lt 20) { throw "Le token Vercel semble trop court." }

  Set-EnvValue "SOPHENIC_VERCEL_TOKEN" $vercelToken
  Remove-EnvValue "SOPHENIC_VERCEL_CLIENT_ID"
  Remove-EnvValue "SOPHENIC_VERCEL_CLIENT_SECRET"
  Remove-EnvValue "SOPHENIC_VERCEL_CLIENT_AUTH"
  Remove-EnvValue "SOPHENIC_VERCEL_OAUTH_SCOPES"

  Write-Host ""
  Write-Host "Vercel configuré en mode token personnel." -ForegroundColor Green
  Write-Host "Aucun Client ID Vercel ni Redirect URI n'est nécessaire dans ce mode." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Configuration enregistrée dans : $envPath" -ForegroundColor Green
Write-Host "Redémarre SOPHENIC : npm run sophenic:start" -ForegroundColor Cyan
