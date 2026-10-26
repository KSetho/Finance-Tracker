# Push backend/.env keys to Vercel Production (and Preview) without printing secret values.
# Prerequisites: `npx vercel link` already done from the repo root.
# Usage: powershell -File scripts/push-vercel-env.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envFile = Join-Path $root "backend\.env"
if (-not (Test-Path $envFile)) { throw "Missing backend/.env" }

function Get-DotEnvMap([string]$path) {
  $map = @{}
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $key = $line.Substring(0, $i).Trim()
    $val = $line.Substring($i + 1).Trim()
    if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $map[$key] = $val
  }
  return $map
}

$map = Get-DotEnvMap $envFile
$required = @(
  "OWNER_EMAIL",
  "DATABASE_URL",
  "SECRET_KEY",
  "EMAIL_PROVIDER",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL"
)
foreach ($k in $required) {
  if (-not $map.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($map[$k])) {
    throw "backend/.env missing required key: $k"
  }
}

# Production forces Secure cookies + https FRONTEND_ORIGIN.
# Set FRONTEND_ORIGIN after the first deploy knows the *.vercel.app URL, then re-run.
$overrides = @{
  APP_ENV = "production"
  TRUSTED_PROXY = "true"
  PASSWORD_RESET_ENABLED = $(if ($map.ContainsKey("PASSWORD_RESET_ENABLED")) { $map["PASSWORD_RESET_ENABLED"] } else { "true" })
}

$keys = @(
  "OWNER_EMAIL", "DATABASE_URL", "SECRET_KEY", "SESSION_COOKIE_NAME",
  "EMAIL_PROVIDER", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL", "SMTP_STARTTLS", "SMTP_TIMEOUT_SECONDS",
  "PASSWORD_RESET_ENABLED", "PASSWORD_RESET_EXPIRY_MINUTES",
  "DATA_WIPE_EXPIRY_MINUTES", "REPORT_MAX_REQUESTS", "REPORT_WINDOW_MINUTES",
  "FRONTEND_ORIGIN"
) | Where-Object { $map.ContainsKey($_) -or $overrides.ContainsKey($_) }

Set-Location $root
foreach ($key in $keys) {
  $value = if ($overrides.ContainsKey($key)) { $overrides[$key] } else { $map[$key] }
  if ([string]::IsNullOrWhiteSpace($value)) { continue }
  if ($key -eq "FRONTEND_ORIGIN" -and $value -notmatch "^https://") {
    Write-Host "skip $key (must be https:// for production; set after first deploy)"
    continue
  }
  Write-Host "upsert $key (len=$($value.Length))"
  $value | npx vercel env add $key production --force 2>$null
  if ($LASTEXITCODE -ne 0) {
    # Older CLI variants
    $value | npx vercel env add $key production
  }
}

Write-Host "Done. If FRONTEND_ORIGIN was skipped, deploy once, then set it to https://YOUR-PROJECT.vercel.app and redeploy."
