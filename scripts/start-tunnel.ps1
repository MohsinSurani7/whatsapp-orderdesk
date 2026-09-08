# trycloudflare quick tunnel = naya random URL har baar process restart par.
# Same link rakhne ke liye yeh window open rakho.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $root "bin\cloudflared.exe"
$envFile = Join-Path $root ".env.local"

if (-not (Test-Path $cloudflared)) {
  throw "cloudflared not found at $cloudflared"
}

function Save-AppUrl([string]$url) {
  if (-not (Test-Path $envFile)) { return }
  $text = Get-Content $envFile -Raw
  if ($text -match "NEXT_PUBLIC_APP_URL=") {
    $text = [regex]::Replace($text, "NEXT_PUBLIC_APP_URL=.*", "NEXT_PUBLIC_APP_URL=$url")
  } else {
    $text = $text.TrimEnd() + "`r`nNEXT_PUBLIC_APP_URL=$url`r`n"
  }
  Set-Content -Path $envFile -Value $text.TrimEnd() -Encoding utf8
  Write-Host ""
  Write-Host "Public site:  $url"
  Write-Host "Webhook:      $url/api/webhooks/whatsapp"
  Write-Host "Yeh link isi window ke chalte hue same rahegi. Meta webhook update karo."
  Write-Host ""
}

$saved = $false
& $cloudflared tunnel --edge-ip-version 4 --protocol http2 --url http://127.0.0.1:3000 2>&1 | ForEach-Object {
  $line = "$_"
  Write-Host $line
  if (-not $saved -and $line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
    Save-AppUrl $Matches[0]
    $saved = $true
  }
}
