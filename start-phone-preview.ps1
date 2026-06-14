<#
.SYNOPSIS
    Build ReadyRoute and expose it over a public HTTPS tunnel for phone testing.

.DESCRIPTION
    - Builds `frontend/dist`
    - Ensures the backend is serving the built frontend on `http://127.0.0.1:8000`
    - Starts a LocalTunnel HTTPS URL that forwards to port 8000
    - Writes the tunnel URL to `.data\phone-preview.url`

.PARAMETER Stop
    Stop the active phone-preview tunnel if present.
#>

[CmdletBinding()]
param(
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$DataDir = Join-Path $PSScriptRoot ".data"
$TunnelPidFile = Join-Path $DataDir "phone-preview.pid"
$TunnelLogFile = Join-Path $DataDir "phone-preview.log"
$TunnelUrlFile = Join-Path $DataDir "phone-preview.url"

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Stop-Tunnel {
    if (Test-Path $TunnelPidFile) {
        $pidValue = (Get-Content $TunnelPidFile | Select-Object -First 1).Trim()
        if ($pidValue -match "^\d+$") {
            $proc = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Info "Stopping phone preview tunnel PID $pidValue"
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Remove-Item $TunnelPidFile -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $TunnelUrlFile -Force -ErrorAction SilentlyContinue
}

if ($Stop) {
    Stop-Tunnel
    return
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

Write-Info "Building frontend production bundle..."
Push-Location (Join-Path $PSScriptRoot "frontend")
try {
    npm run build | Out-Host
} finally {
    Pop-Location
}

Write-Info "Checking backend health..."
try {
    $health = Invoke-WebRequest -Uri http://127.0.0.1:8000/health -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -ne 200) {
        throw "Backend health returned $($health.StatusCode)"
    }
} catch {
    throw "Backend is not running on http://127.0.0.1:8000. Start the backend first, then rerun this script."
}

Stop-Tunnel
if (Test-Path $TunnelLogFile) { Remove-Item $TunnelLogFile -Force -ErrorAction SilentlyContinue }

Write-Info "Starting HTTPS tunnel..."
$proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npx --yes localtunnel --port 8000 > `"$TunnelLogFile`" 2>&1" `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -PassThru

$proc.Id | Set-Content $TunnelPidFile

$url = $null
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $TunnelLogFile) {
        $match = Select-String -Path $TunnelLogFile -Pattern "your url is:\s+(https://\S+)" -AllMatches -ErrorAction SilentlyContinue
        if ($match) {
            $url = $match.Matches[-1].Groups[1].Value.Trim()
            break
        }
    }
    $running = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if (-not $running) {
        break
    }
}

if (-not $url) {
    throw "Tunnel did not produce a public URL. Check $TunnelLogFile."
}

$url | Set-Content $TunnelUrlFile
Write-Info "Phone preview ready:"
Write-Host $url -ForegroundColor Green
Write-Info "Open that URL on your phone and use the Notifications toggle in the sidebar."
