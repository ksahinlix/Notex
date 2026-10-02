<#
.SYNOPSIS
  Fetches a Notex backup (D23) and keeps the most recent ones.

.DESCRIPTION
  The other half of GET /api/backup: the server hands over one gzipped JSON of
  everything, and this writes it somewhere. Point -Dir at a folder your cloud
  drive syncs (OneDrive, Google Drive) and the copy is off-site without any
  storage account, API key or card.

  Run it from Task Scheduler once a day. It exits non-zero on failure, so a
  failed backup shows up as a failed task rather than silently never happening.

.EXAMPLE
  $env:NOTEX_CRON_KEY = "..."
  .\pull-backup.ps1 -Dir "$env:USERPROFILE\OneDrive\Notex-yedek"
#>
param(
  [string]$Url = "https://notex-r2zk.onrender.com/api/backup",
  # The server's CRON_SECRET. Prefer the environment variable over typing it
  # here, so it stays out of the file and out of your shell history.
  [string]$Key = $env:NOTEX_CRON_KEY,
  [string]$Dir = "$env:USERPROFILE\OneDrive\Notex-yedek",
  # How many files to keep. One a day, so 60 is two months.
  [int]$Keep = 60,
  # Render's free instance sleeps; waking it can take a minute.
  [int]$Retries = 3
)

$ErrorActionPreference = "Stop"

if (-not $Key) {
  Write-Error "No key. Set NOTEX_CRON_KEY to the server's CRON_SECRET, or pass -Key."
  exit 1
}
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmss")
$file = Join-Path $Dir "notex-$stamp`Z.json.gz"

$attempt = 0
while ($true) {
  $attempt++
  try {
    # -OutFile writes the bytes as they come, so a large backup is not held in memory.
    $res = Invoke-WebRequest -Uri $Url -Headers @{ "x-cron-key" = $Key } -OutFile $file -PassThru -TimeoutSec 180
    break
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401) {
      Write-Error "The server said 401: NOTEX_CRON_KEY does not match its CRON_SECRET."
      exit 1
    }
    if ($attempt -ge $Retries) {
      Write-Error "Backup failed after $attempt attempts: $($_.Exception.Message)"
      exit 1
    }
    # Most likely the free instance waking up. Give it a moment.
    Write-Host "Attempt $attempt failed ($status); trying again in 30s..."
    Start-Sleep -Seconds 30
  }
}

$size = (Get-Item $file).Length
$counts = $res.Headers["x-notex-counts"]
Write-Host "Saved $file ($([math]::Round($size / 1KB, 1)) KB)$(if ($counts) { " - $counts" })"

# Make sure we saved a backup and not, say, an HTML error page from a proxy.
# A gzip file always starts 1f 8b.
$magic = [System.IO.File]::ReadAllBytes($file) | Select-Object -First 2
if ($size -lt 2 -or $magic[0] -ne 0x1f -or $magic[1] -ne 0x8b) {
  Write-Error "That is not a gzip file; leaving $file for you to look at."
  exit 1
}

# Prune, oldest first. Only ever touches files this script makes.
Get-ChildItem -Path $Dir -Filter "notex-*.json.gz" |
  Sort-Object Name -Descending |
  Select-Object -Skip $Keep |
  ForEach-Object {
    Write-Host "Removing old backup $($_.Name)"
    Remove-Item $_.FullName -Force
  }
