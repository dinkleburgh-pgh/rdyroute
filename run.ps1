<#
.SYNOPSIS
    Start the ReadyRoute V2 stack (FastAPI backend + Vite/React frontend).

.DESCRIPTION
    PowerShell equivalent of the TruckApp run_streamlit.sh helper. Self-heals
    common dev-setup issues:
      * creates / repairs the Python virtual environment in .venv
      * installs / upgrades requirements.txt
      * installs frontend npm dependencies if node_modules is missing
      * launches uvicorn and vite as background processes
      * writes PID + log files under .data\ so re-runs detect existing servers
      * opens the frontend URL in the default browser

.PARAMETER Stop
    Stop any running backend/frontend processes recorded in .data\*.pid.

.PARAMETER Restart
    Stop existing servers (if any) and start fresh.

.PARAMETER NoBrowser
    Skip auto-opening the browser.

.EXAMPLE
    .\run.ps1
    .\run.ps1 -Restart
    .\run.ps1 -Stop
#>

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Restart,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# ---------------------------------------------------------------------------
# Configuration (env overrides supported)
# ---------------------------------------------------------------------------
$VenvDir       = if ($env:VENV_DIR)       { $env:VENV_DIR }       else { '.venv' }
$LogDir        = if ($env:LOG_DIR)        { $env:LOG_DIR }        else { '.data' }
$BackendHost   = if ($env:BACKEND_HOST)   { $env:BACKEND_HOST }   else { '127.0.0.1' }
$BackendPort   = if ($env:BACKEND_PORT)   { $env:BACKEND_PORT }   else { '8000' }
$FrontendPort  = if ($env:FRONTEND_PORT)  { $env:FRONTEND_PORT }  else { '5180' }
$FrontendDir   = Join-Path $PSScriptRoot 'frontend'

$BackendLog    = Join-Path $LogDir 'backend.log'
$BackendPid    = Join-Path $LogDir 'backend.pid'
$FrontendLog   = Join-Path $LogDir 'frontend.log'
$FrontendPidF  = Join-Path $LogDir 'frontend.pid'
$FrontendSentinel = Join-Path $LogDir 'frontend.sentinel'  # watchdog monitors this file

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info  ([string]$m) { Write-Host "[INFO] $m"  -ForegroundColor Cyan }
function Write-Warn2 ([string]$m) { Write-Host "[WARN] $m"  -ForegroundColor Yellow }
function Write-Err   ([string]$m) { Write-Host "[ERROR] $m" -ForegroundColor Red }

function Test-Pid {
    param([string]$PidFile, [string]$NameMatch)
    if (-not (Test-Path $PidFile)) { return $null }
    $procId = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if (-not $procId) { return $null }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    if ($NameMatch -and ($proc.ProcessName -notmatch $NameMatch)) { return $null }
    return $proc
}

function Stop-Tracked {
    param([string]$Label, [string]$PidFile)
    $proc = Test-Pid -PidFile $PidFile
    if ($proc) {
        Write-Info "Stopping $Label (PID $($proc.Id))..."
        try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { Write-Warn2 "Failed to stop PID $($proc.Id): $_" }
    } else {
        Write-Info "$Label not running."
    }
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
}

function Resolve-Python {
    foreach ($cand in @('python', 'py -3', 'python3')) {
        $parts = $cand -split '\s+', 2
        $exe = Get-Command $parts[0] -ErrorAction SilentlyContinue
        if (-not $exe) { continue }
        $argsList = if ($parts.Count -gt 1) { @($parts[1], '-c', 'import sys;raise SystemExit(0 if sys.version_info>=(3,10) else 1)') }
                    else                    { @('-c', 'import sys;raise SystemExit(0 if sys.version_info>=(3,10) else 1)') }
        & $exe.Source @argsList 2>$null
        if ($LASTEXITCODE -eq 0) { return ,@($exe.Source) + $argsList[0..($argsList.Count-3)] }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Stop mode
# ---------------------------------------------------------------------------
function Stop-Frontend {
    # Remove sentinel so watchdog exits gracefully and kills Vite itself
    if (Test-Path $FrontendSentinel) { Remove-Item $FrontendSentinel -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
    # Kill the watchdog process
    Stop-Tracked -Label 'Frontend watchdog' -PidFile $FrontendPidF
    # Kill any orphaned node process still holding the frontend port
    $lines = netstat -ano 2>$null | Select-String ":${FrontendPort}\s+" | Where-Object { $_ -match 'LISTENING' }
    foreach ($line in $lines) {
        $pidStr = ($line.Line.Trim() -split '\s+')[-1]
        if ($pidStr -match '^\d+$') {
            $orphan = Get-Process -Id ([int]$pidStr) -ErrorAction SilentlyContinue
            if ($orphan -and $orphan.ProcessName -match 'node') {
                Write-Info "Killing orphaned Vite node (PID $([int]$pidStr))"
                Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

if ($Stop -or $Restart) {
    Stop-Tracked -Label 'Backend (uvicorn)' -PidFile $BackendPid
    Stop-Frontend
    if ($Stop) { return }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------------------
# Python venv + deps
# ---------------------------------------------------------------------------
$VenvPy = Join-Path $VenvDir 'Scripts\python.exe'

if (-not (Test-Path $VenvPy)) {
    Write-Info "Creating virtual environment in '$VenvDir'..."
    $pyInfo = Resolve-Python
    if (-not $pyInfo) {
        Write-Err "Python 3.10+ not found. Install Python from https://www.python.org/downloads/ and retry."
        exit 1
    }
    & $pyInfo[0] -m venv $VenvDir
    if (-not (Test-Path $VenvPy)) { Write-Err "venv creation failed."; exit 1 }
}

Write-Info "Using $(& $VenvPy --version 2>&1)"

Write-Info "Upgrading pip tooling..."
& $VenvPy -m pip install --upgrade pip setuptools wheel | Out-Null

if (Test-Path 'requirements.txt') {
    Write-Info "Installing Python requirements..."
    & $VenvPy -m pip install --upgrade -r requirements.txt
} else {
    Write-Warn2 "requirements.txt not found. Skipping Python deps."
}

# ---------------------------------------------------------------------------
# Backend (uvicorn)
# ---------------------------------------------------------------------------
$existing = Test-Pid -PidFile $BackendPid
if ($existing) {
    Write-Info "Backend already running (PID $($existing.Id)) — http://${BackendHost}:${BackendPort}"
} else {
    Write-Info "Starting FastAPI backend on http://${BackendHost}:${BackendPort}..."
    $backendArgs = @('-m', 'uvicorn', 'main:app', '--host', $BackendHost, '--port', $BackendPort, '--reload')
    $proc = Start-Process -FilePath $VenvPy -ArgumentList $backendArgs `
        -WorkingDirectory $PSScriptRoot `
        -RedirectStandardOutput $BackendLog -RedirectStandardError "$BackendLog.err" `
        -WindowStyle Hidden -PassThru
    $proc.Id | Out-File -FilePath $BackendPid -Encoding ascii
    Start-Sleep -Seconds 2
    if ($proc.HasExited) {
        Write-Err "Backend failed to start. Recent log:"
        if (Test-Path $BackendLog) { Get-Content $BackendLog -Tail 40 }
        if (Test-Path "$BackendLog.err") { Get-Content "$BackendLog.err" -Tail 40 }
        exit 1
    }
    Write-Info "Backend started (PID $($proc.Id)). Log: $BackendLog"
}

# ---------------------------------------------------------------------------
# Frontend (vite)
# ---------------------------------------------------------------------------
if (-not (Test-Path $FrontendDir)) {
    Write-Warn2 "frontend/ not found — skipping frontend startup."
} else {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Warn2 "npm not found in PATH. Install Node.js LTS to run the frontend."
    } else {
        if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
            Write-Info "Installing frontend npm dependencies (this may take a minute)..."
            Push-Location $FrontendDir
            try { & $npm.Source install } finally { Pop-Location }
        }

        $existingFE = Test-Pid -PidFile $FrontendPidF
        if ($existingFE) {
            Write-Info "Frontend already running (PID $($existingFE.Id)) — http://localhost:${FrontendPort}"
        } else {
            Write-Info "Starting Vite dev server (with watchdog) on http://localhost:${FrontendPort}..."
            $npmCmd = Join-Path (Split-Path $npm.Source -Parent) 'npm.cmd'
            if (-not (Test-Path $npmCmd)) { $npmCmd = $npm.Source }

            # Create sentinel — watchdog exits when this file is removed
            'running' | Out-File -FilePath $FrontendSentinel -Encoding ascii

            # Build the watchdog script with variables already substituted, then encode it
            # so that Start-Process never needs to parse paths-with-spaces as arguments.
            $esc = { param($s) $s -replace "'", "''" }   # escape single-quotes for PowerShell literals
            $inlineScript = @"
`$NpmCmd       = '$( & $esc $npmCmd )'
`$FrontendDir  = '$( & $esc $FrontendDir )'
`$FrontendPort = '$FrontendPort'
`$LogFile      = '$( & $esc $FrontendLog )'
`$SentinelFile = '$( & $esc $FrontendSentinel )'
. '$( & $esc (Join-Path $PSScriptRoot '_vite_watchdog.ps1') )'
"@
            $encodedCmd = [Convert]::ToBase64String(
                [System.Text.Encoding]::Unicode.GetBytes($inlineScript)
            )

            $proc = Start-Process -FilePath 'powershell.exe' `
                -ArgumentList @('-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCmd) `
                -WorkingDirectory $PSScriptRoot `
                -WindowStyle Hidden -PassThru
            $proc.Id | Out-File -FilePath $FrontendPidF -Encoding ascii
            Start-Sleep -Seconds 3
            if ($proc.HasExited) {
                Write-Err "Frontend watchdog failed to start. Recent log:"
                if (Test-Path $FrontendLog) { Get-Content $FrontendLog -Tail 40 }
                if (Test-Path "$FrontendLog.err") { Get-Content "$FrontendLog.err" -Tail 40 }
            } else {
                Write-Info "Frontend watchdog started (PID $($proc.Id)) — auto-restarts on crash. Log: $FrontendLog"
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$frontendUrl = "http://localhost:$FrontendPort"
$backendUrl  = "http://${BackendHost}:${BackendPort}"
Write-Host ""
Write-Info "ReadyRoute V2 is up:"
Write-Info "  Frontend : $frontendUrl"
Write-Info "  Backend  : $backendUrl   (docs: $backendUrl/docs)"
Write-Info "Logs in    : $LogDir\"
Write-Info "Stop with  : .\run.ps1 -Stop"

if (-not $NoBrowser) {
    try { Start-Process $frontendUrl | Out-Null } catch { }
}
