$ErrorActionPreference = 'Stop'
$projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectDirectory
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Install Node.js 22.12 or later, then run this launcher again.'
  Read-Host 'Press Enter to close'
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules'))) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& npm.cmd run setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$appAddress = 'http://localhost:3000'
if (Test-Path -LiteralPath '.env') {
  $addressLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^APP_URL=' } | Select-Object -First 1
  if ($addressLine) { $appAddress = $addressLine.Substring(8).Trim().Trim('"').Trim("'") }
}
try {
  $health = Invoke-RestMethod -Uri ($appAddress.TrimEnd('/') + '/health') -TimeoutSec 2
  if ($health.status -eq 'ok' -and $health.service -eq 'stow') {
    Start-Process $appAddress
    exit 0
  }
} catch {}
$browserJob = Start-Job -ArgumentList $appAddress -ScriptBlock {
  param($address)
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $health = Invoke-RestMethod -Uri ($address.TrimEnd('/') + '/health') -TimeoutSec 1
      if ($health.status -eq 'ok' -and $health.service -eq 'stow') {
        Start-Process $address
        return
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
}
Write-Host 'Keep this terminal open while using Stow. Press Ctrl+C to stop.'
& npm.cmd run dev
Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
