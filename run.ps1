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

    Before starting, run.ps1 auto-frees the backend (8000) and frontend (5180)
    ports: stops any Docker container publishing them and kills orphaned
    uvicorn/node processes still bound to them. This prevents the duplicate-
    backend class of bugs (PUTs and GETs hitting different processes with
    stale ORM caches).

.EXAMPLE
    .\run.ps1
    .\run.ps1 -Restart
    .\run.ps1 -Stop
#>

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Restart,
    [switch]$NoBrowser,
    [switch]$NoMenu
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
function Write-Info  ([string]$m) { Write-Host "  $m"  -ForegroundColor Cyan }
function Write-Warn2 ([string]$m) { Write-Host "  $m"  -ForegroundColor Yellow }
function Write-Err   ([string]$m) { Write-Host "  $m" -ForegroundColor Red }

function Write-Banner {
    $w = 58
    $line = [string]::new([char]0x2500, $w)
    Write-Host ""
    Write-Host "  $([char]0x250C)$line$([char]0x2510)" -ForegroundColor DarkBlue
    Write-Host "  $([char]0x2502)$((' ' * $w))$([char]0x2502)" -ForegroundColor DarkBlue
    Write-Host "  $([char]0x2502)$('  ReadyRoute V2'.PadRight($w))$([char]0x2502)" -ForegroundColor Blue
    Write-Host "  $([char]0x2502)$('  Warehouse Dock Management System'.PadRight($w))$([char]0x2502)" -ForegroundColor DarkCyan
    Write-Host "  $([char]0x2502)$((' ' * $w))$([char]0x2502)" -ForegroundColor DarkBlue
    Write-Host "  $([char]0x2514)$line$([char]0x2518)" -ForegroundColor DarkBlue
    Write-Host ""
}

function Write-Step ([string]$icon, [string]$label, [string]$value = '') {
    if ($value) {
        Write-Host "  $icon  " -NoNewline -ForegroundColor DarkCyan
        Write-Host "$label " -NoNewline -ForegroundColor Gray
        Write-Host $value -ForegroundColor White
    } else {
        Write-Host "  $icon  " -NoNewline -ForegroundColor DarkCyan
        Write-Host $label -ForegroundColor Gray
    }
}

function Write-Ok ([string]$label, [string]$value = '') {
    Write-Host "  $([char]0x2714)  " -NoNewline -ForegroundColor Green
    Write-Host "$label " -NoNewline -ForegroundColor Gray
    Write-Host $value -ForegroundColor White
}

function Write-Divider {
    Write-Host "  $([string]::new([char]0x2500, 58))" -ForegroundColor DarkGray
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 20
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                return $true
            }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

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

function Stop-Backend {
    Stop-Tracked -Label 'Backend (uvicorn)' -PidFile $BackendPid

    # uvicorn --reload spawns a watcher + a worker child. Kill any remaining
    # listeners on the backend port, including ghost PIDs (process died but
    # kernel socket not yet released) by sweeping WMI for uvicorn orphans.
    $port = [int]$BackendPort
    Start-Sleep -Milliseconds 600
    $listeners = Get-PortListeners -Port $port
    foreach ($o in $listeners) {
        $exists = Get-Process -Id $o.Pid -ErrorAction SilentlyContinue
        if ($exists) {
            Write-Info "Killing orphaned uvicorn worker PID $($o.Pid)..."
            Invoke-TaskKill -ProcessId $o.Pid
        } else {
            # Ghost PID — process is gone but socket lingers. Sweep WMI for any
            # python process whose command line matches our stack.
            Write-Warn2 "Ghost socket on port $port (PID $($o.Pid) no longer exists). Sweeping uvicorn orphans via WMI..."
            $orphans = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -match '^python.*\.exe$' -and
                $_.CommandLine -match 'uvicorn|main:app|multiprocessing|spawn_main'
            }
            foreach ($p in $orphans) {
                Write-Info "Killing orphan $($p.Name) PID $($p.ProcessId)..."
                Invoke-TaskKill -ProcessId $p.ProcessId
            }
        }
    }
    Start-Sleep -Milliseconds 800
}

function Get-PortListeners {
    param([int]$Port)
    $results = @()
    $lines = netstat -ano 2>$null | Select-String ":${Port}\s+" | Where-Object { $_ -match 'LISTENING' }
    $seen = @{}
    foreach ($line in $lines) {
        $pidStr = ($line.Line.Trim() -split '\s+')[-1]
        if ($pidStr -notmatch '^\d+$') { continue }
        $procId = [int]$pidStr
        if ($seen.ContainsKey($procId)) { continue }
        $seen[$procId] = $true
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $cim  = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        $cmd  = if ($cim) { $cim.CommandLine } else { '' }
        $name = if ($proc) { $proc.ProcessName } else { 'unknown' }
        $isDocker = ($name -match 'com\.docker|wslrelay|wsl|dockerd|vpnkit') -or ($cmd -match 'docker')
        $results += [pscustomobject]@{
            Pid         = $procId
            ProcessName = $name
            CommandLine = $cmd
            IsDocker    = $isDocker
        }
    }
    return $results
}

function Clear-Port {
    # Free $Port by stopping any unrelated process listening on it.
    # Docker port-forwards are auto-stopped via 'docker stop'.
    param(
        [string]$Label,
        [int]$Port,
        [int]$AllowedPid = 0
    )
    $owners = Get-PortListeners -Port $Port | Where-Object { $_.Pid -ne $AllowedPid }
    if (-not $owners) { return }

    Write-Warn2 "Port $Port ($Label) is in use by $($owners.Count) process(es); cleaning up..."
    foreach ($o in $owners) {
        $tag = if ($o.IsDocker) { ' [Docker]' } else { '' }
        Write-Warn2 "  PID $($o.Pid) $($o.ProcessName)$tag"
    }

    # Stop any docker containers publishing this port first
    $dockerOwners = $owners | Where-Object { $_.IsDocker }
    if ($dockerOwners) {
        $docker = Get-Command docker -ErrorAction SilentlyContinue
        if ($docker) {
            $containers = & $docker.Source ps --filter "publish=$Port" --format '{{.ID}}' 2>$null
            foreach ($cid in $containers) {
                if ($cid) {
                    Write-Info "Stopping Docker container $cid (publishing port $Port)..."
                    & $docker.Source stop $cid | Out-Null
                }
            }
        } else {
            Write-Warn2 "Docker proxy holds port $Port but 'docker' CLI not in PATH; will try direct kill."
        }
    }

    # Kill any remaining listeners (including stale uvicorn/node workers).
    # Use 'taskkill /F /T' so we tear down the whole process tree (uvicorn
    # --reload spawns a worker child that re-acquires the socket if the
    # parent alone is killed).
    $owners = Get-PortListeners -Port $Port | Where-Object { $_.Pid -ne $AllowedPid }
    foreach ($o in $owners) {
        Write-Info "Killing stale $Label listener tree PID $($o.Pid) ($($o.ProcessName))..."
        Invoke-TaskKill -ProcessId $o.Pid
        if ($LASTEXITCODE -ne 0) {
            try { Stop-Process -Id $o.Pid -Force -ErrorAction Stop } catch { Write-Warn2 "Could not kill PID $($o.Pid): $_" }
        }
    }

    # Also walk parent chain — uvicorn worker's parent (the reload watcher)
    # may itself hold a duplicate handle / spawn a replacement.
    foreach ($o in $owners) {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($o.Pid)" -ErrorAction SilentlyContinue
        if ($cim -and $cim.ParentProcessId -and $cim.ParentProcessId -ne 0) {
            $parent = Get-Process -Id $cim.ParentProcessId -ErrorAction SilentlyContinue
            if ($parent -and $parent.ProcessName -match 'python|node') {
                Write-Info "Killing parent reload watcher PID $($parent.Id) ($($parent.ProcessName))..."
                Invoke-TaskKill -ProcessId $parent.Id
            }
        }
    }

    Start-Sleep -Milliseconds 1500
    $still = Get-PortListeners -Port $Port | Where-Object { $_.Pid -ne $AllowedPid }
    if ($still) {
        # One more aggressive sweep: kill ANY python.exe/node.exe still on the port
        foreach ($o in $still) {
            Write-Warn2 "Forcing kill on PID $($o.Pid) ($($o.ProcessName))..."
            Invoke-TaskKill -ProcessId $o.Pid
        }
        Start-Sleep -Milliseconds 1000
        $still = Get-PortListeners -Port $Port | Where-Object { $_.Pid -ne $AllowedPid }
    }
    if ($still) {
        # netstat sometimes reports a ghost PID after the parent died but a
        # multiprocessing-spawn child inherited the listening socket. Sweep
        # WMI for any python/node process whose cmdline matches our stack.
        Write-Warn2 "Listener PID is unresolvable; sweeping orphaned uvicorn/vite processes via WMI..."
        $orphans = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -match '^(python|node)\.exe$' -and (
                $_.CommandLine -match 'uvicorn|main:app|multiprocessing-fork|spawn_main' -or
                $_.CommandLine -match 'vite|esbuild'
            )
        }
        foreach ($p in $orphans) {
            Write-Info "Killing orphan $($p.Name) PID $($p.ProcessId)..."
            Invoke-TaskKill -ProcessId $p.ProcessId
        }
        Start-Sleep -Milliseconds 1500
        $still = Get-PortListeners -Port $Port | Where-Object { $_.Pid -ne $AllowedPid }
    }
    if ($still) {
        Write-Err "Port $Port still in use after cleanup. Remaining PIDs: $($still.Pid -join ', ')"
        Write-Err "These processes may be running under a different user/elevation. Run PowerShell as Administrator and retry."
        exit 1
    }
    Write-Info "Port $Port is now free."
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

function Invoke-TaskKill {
    param([int]$ProcessId)
    try {
        & cmd.exe /c "taskkill /F /T /PID $ProcessId >nul 2>nul" | Out-Null
    } catch { }
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

function Start-FrontendProcess {
    param([string[]]$ArgumentList)
    $npmCmdInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
    $npmCmd = if ($npmCmdInfo) { $npmCmdInfo.Source } else { $null }
    if (-not $npmCmd) {
        throw "npm.cmd not found in PATH."
    }

    if (Test-Path $FrontendLog) { Remove-Item $FrontendLog -Force -ErrorAction SilentlyContinue }
    if (Test-Path "$FrontendLog.err") { Remove-Item "$FrontendLog.err" -Force -ErrorAction SilentlyContinue }

    $proc = Start-Process -FilePath $npmCmd `
        -ArgumentList $ArgumentList `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $FrontendLog `
        -RedirectStandardError "$FrontendLog.err" `
        -WindowStyle Hidden `
        -PassThru
    $proc.Id | Out-File -FilePath $FrontendPidF -Encoding ascii
    return $proc
}

Write-Banner

if ($Stop -or $Restart) {
    Write-Step "$([char]0x25A0)" "Stopping services..."
    Stop-Backend
    Stop-Frontend
    if ($Stop) {
        Write-Host ""
        Write-Ok "All services stopped."
        Write-Host ""
        return
    }
    Write-Host ""
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ---------------------------------------------------------------------------
# Python venv + deps
# ---------------------------------------------------------------------------
Write-Step "$([char]0x25B6)" "Python environment"
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

$pyVersion = (& $VenvPy --version 2>&1).ToString().Trim()
Write-Ok "Python ready" $pyVersion

Write-Step "$([char]0x25B6)" "Installing dependencies..."
& $VenvPy -m pip install --upgrade pip setuptools wheel | Out-Null

if (Test-Path 'requirements.txt') {
    & $VenvPy -m pip install --upgrade -r requirements.txt | Out-Null
    Write-Ok "Python packages installed"
} else {
    Write-Warn2 "requirements.txt not found — skipping Python deps."
}

# ---------------------------------------------------------------------------
# Backend (uvicorn) / Frontend (vite) — reusable so the interactive menu below
# can restart either one without re-running the whole script.
# ---------------------------------------------------------------------------
function Start-Backend {
    Write-Divider
    Write-Step "$([char]0x25B6)" "Backend" "FastAPI + uvicorn  :$BackendPort"
    $existing = Test-Pid -PidFile $BackendPid
    if ($existing) {
        $healthy = $false
        try {
            $null = Invoke-RestMethod "http://${BackendHost}:${BackendPort}/health" -TimeoutSec 2 -ErrorAction Stop
            $healthy = $true
        } catch { }

        if ($healthy) {
            Write-Ok "Already running" "PID $($existing.Id)  http://${BackendHost}:${BackendPort}"
            return
        } else {
            Write-Warn2 "PID $($existing.Id) alive but not responding — restarting..."
            Stop-Tracked -Label 'Backend (uvicorn)' -PidFile $BackendPid
        }
    }
    Clear-Port -Label 'backend (uvicorn)' -Port ([int]$BackendPort)
    Write-Info "Launching uvicorn..."
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
        return
    }
    Write-Ok "Backend started" "PID $($proc.Id)  http://${BackendHost}:${BackendPort}"
}

function Start-Frontend {
    Write-Divider
    Write-Step "$([char]0x25B6)" "Frontend" "React + Vite  :$FrontendPort"
    if (-not (Test-Path $FrontendDir)) {
        Write-Warn2 "frontend/ not found — skipping frontend startup."
        return
    }
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Warn2 "npm not found in PATH. Install Node.js LTS to run the frontend."
        return
    }
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Write-Info "Installing npm dependencies (first run, may take a minute)..."
        Push-Location $FrontendDir
        try { & $npm.Source install | Out-Null } finally { Pop-Location }
        Write-Ok "npm packages installed"
    }

    $existingFE = Test-Pid -PidFile $FrontendPidF
    if ($existingFE) {
        $feHealthy = $false
        try {
            $null = Invoke-WebRequest "http://localhost:${FrontendPort}" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            $feHealthy = $true
        } catch { }

        if ($feHealthy) {
            Write-Ok "Already running" "PID $($existingFE.Id)  http://localhost:${FrontendPort}"
            return
        } else {
            Write-Warn2 "PID $($existingFE.Id) alive but port $FrontendPort not responding — restarting..."
            Stop-Frontend
        }
    }
    Clear-Port -Label 'frontend (vite)' -Port ([int]$FrontendPort)
    Write-Info "Launching Vite dev server..."
    $frontendArgs = @('run', 'dev', '--', '--host', '0.0.0.0', '--port', $FrontendPort)
    $proc = Start-FrontendProcess -ArgumentList $frontendArgs
    $frontendHealthy = Wait-HttpReady -Url "http://127.0.0.1:${FrontendPort}" -TimeoutSeconds 20
    if ($proc.HasExited -or -not $frontendHealthy) {
        Write-Warn2 "Vite didn't respond in time — retrying once..."
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
        if (Test-Path $FrontendPidF) { Remove-Item $FrontendPidF -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
        $proc = Start-FrontendProcess -ArgumentList $frontendArgs
        $frontendHealthy = Wait-HttpReady -Url "http://127.0.0.1:${FrontendPort}" -TimeoutSeconds 20
    }

    if ($proc.HasExited -or -not $frontendHealthy) {
        Write-Err "Frontend failed to start cleanly. Recent log:"
        if (Test-Path $FrontendLog) { Get-Content $FrontendLog -Tail 40 }
        if (Test-Path "$FrontendLog.err") { Get-Content "$FrontendLog.err" -Tail 40 }
    } else {
        Write-Ok "Frontend started" "PID $($proc.Id)  http://localhost:${FrontendPort}"
    }
}

Start-Backend
Start-Frontend

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$frontendUrl = "http://localhost:$FrontendPort"
$backendUrl  = "http://${BackendHost}:${BackendPort}"

Write-Divider
Write-Host ""
Write-Host "  $([char]0x2713)  " -NoNewline -ForegroundColor Green
Write-Host "ReadyRoute V2 is running" -ForegroundColor White
Write-Host ""
Write-Host "    App    " -NoNewline -ForegroundColor DarkGray
Write-Host $frontendUrl -ForegroundColor Cyan
Write-Host "    API    " -NoNewline -ForegroundColor DarkGray
Write-Host "$backendUrl/docs" -ForegroundColor DarkCyan
Write-Host "    Logs   " -NoNewline -ForegroundColor DarkGray
Write-Host $LogDir -ForegroundColor DarkGray
Write-Host "    Stop   " -NoNewline -ForegroundColor DarkGray
Write-Host ".\run.ps1 -Stop" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
    try {
        Start-Process $frontendUrl | Out-Null
    } catch { }
}

# ---------------------------------------------------------------------------
# Interactive console menu — Up/Down + Enter to control the running stack
# without leaving this window. Skipped automatically when input/output isn't
# a real interactive console (redirected output, CI, non-console hosts), or
# when -NoMenu is passed for scripted/one-shot use.
# ---------------------------------------------------------------------------
# Reads one keypress in a way that works across the widest range of PowerShell
# hosts. $Host.UI.RawUI.ReadKey is tried first (the technique that plays nicest
# with Windows Terminal / conhost's arrow-key escape sequences); if the host
# doesn't support it at all, falls back to [Console]::ReadKey. Returns an
# object with .VirtualKeyCode and .Character so callers don't care which path
# was used.
function Read-MenuKey {
    try {
        $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        return [pscustomobject]@{ VirtualKeyCode = $k.VirtualKeyCode; Character = $k.Character }
    } catch {
        $k = [Console]::ReadKey($true)
        $vkMap = @{ UpArrow = 38; DownArrow = 40; Enter = 13; Escape = 27; W = 87; S = 83; J = 74; K = 75; Q = 81 }
        $vk = if ($vkMap.ContainsKey($k.Key.ToString())) { $vkMap[$k.Key.ToString()] } else { 0 }
        return [pscustomobject]@{ VirtualKeyCode = $vk; Character = $k.KeyChar }
    }
}

function Show-ArrowMenu {
    param(
        [Parameter(Mandatory = $true)][string[]]$Items,
        [string]$Title = 'Select an action'
    )
    $selected = 0
    while ($true) {
        # Redraw by clearing the screen rather than repositioning the cursor —
        # SetCursorPosition doesn't reliably overwrite in every terminal host
        # (some just keep printing new lines below instead of in place).
        # Clear-Host is a bit more flicker but works consistently everywhere.
        Clear-Host
        Write-Banner
        Write-Host "    App    " -NoNewline -ForegroundColor DarkGray
        Write-Host $frontendUrl -ForegroundColor Cyan
        Write-Host "    API    " -NoNewline -ForegroundColor DarkGray
        Write-Host "$backendUrl/docs" -ForegroundColor DarkCyan
        Write-Host ""
        Write-Host "  $Title" -ForegroundColor Gray
        Write-Host "  $([string]::new([char]0x2500, $Title.Length + 2))" -ForegroundColor DarkGray
        for ($i = 0; $i -lt $Items.Count; $i++) {
            $prefix = if ($i -eq $selected) { "$([char]0x25B8) " } else { '  ' }
            $row = "$prefix$($i + 1). $($Items[$i])".PadRight([Console]::WindowWidth - 1)
            if ($i -eq $selected) {
                Write-Host $row -ForegroundColor Black -BackgroundColor Cyan
            } else {
                Write-Host $row -ForegroundColor Gray
            }
        }
        # Number keys jump straight to that item — a guaranteed-to-work
        # fallback in case arrow-key escape sequences don't parse correctly
        # in a particular terminal/host.
        $k = Read-MenuKey
        switch ($k.VirtualKeyCode) {
            38 { $selected = ($selected - 1 + $Items.Count) % $Items.Count } # Up
            40 { $selected = ($selected + 1) % $Items.Count }               # Down
            87 { $selected = ($selected - 1 + $Items.Count) % $Items.Count } # W
            83 { $selected = ($selected + 1) % $Items.Count }               # S
            75 { $selected = ($selected - 1 + $Items.Count) % $Items.Count } # K
            74 { $selected = ($selected + 1) % $Items.Count }               # J
            13 { return $selected }  # Enter
            27 { return -1 }         # Escape
            81 { return -1 }         # Q
            default {
                if ($k.Character -match '^[1-9]$') {
                    $n = [int]"$($k.Character)" - 1
                    if ($n -ge 0 -and $n -lt $Items.Count) { return $n }
                }
            }
        }
    }
}

function Test-InteractiveConsole {
    if ($NoMenu) { return $false }
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return $false }
    try { [void][Console]::CursorTop; return $true } catch { return $false }
}

if (Test-InteractiveConsole) {
  try {
    $menuItems = @(
        'Restart Frontend (Vite)'
        'Stop Frontend (Vite)'
        'Restart Backend (uvicorn)'
        'Stop Backend (uvicorn)'
        'Restart All'
        'Open App in Browser'
        'Tail Frontend Log'
        'Tail Backend Log'
        'Stop All && Exit'
        'Leave Running && Exit Menu'
    )
    while ($true) {
        $menuTitle = "ReadyRoute V2 - dev console  ($([char]0x2191)/$([char]0x2193) navigate, Enter select, number to jump, Q quit)"
        $choice = Show-ArrowMenu -Items $menuItems -Title $menuTitle
        Write-Host ""
        switch ($choice) {
            0 { Stop-Frontend; Start-Frontend }
            1 { Stop-Frontend; Write-Ok "Frontend stopped." }
            2 { Stop-Backend;  Start-Backend }
            3 { Stop-Backend;  Write-Ok "Backend stopped." }
            4 { Stop-Backend; Stop-Frontend; Start-Backend; Start-Frontend }
            5 { try { Start-Process $frontendUrl | Out-Null } catch { } }
            6 { if (Test-Path $FrontendLog) { Get-Content $FrontendLog -Tail 40 } else { Write-Warn2 "No frontend log yet." }; Write-Host ""; Write-Host "  (press any key to return)" -ForegroundColor DarkGray; [Console]::ReadKey($true) | Out-Null }
            7 { if (Test-Path $BackendLog)  { Get-Content $BackendLog  -Tail 40 } else { Write-Warn2 "No backend log yet." };  Write-Host ""; Write-Host "  (press any key to return)" -ForegroundColor DarkGray; [Console]::ReadKey($true) | Out-Null }
            8 { Stop-Backend; Stop-Frontend; Write-Ok "All services stopped."; break }
            default { break }
        }
        if ($choice -eq 8 -or $choice -eq -1) { break }
    }
    Write-Host ""
  } catch {
    Write-Warn2 "Interactive menu unavailable in this console ($($_.Exception.Message)); services are still running in the background."
    Write-Host "  Use .\run.ps1 -Stop / -Restart from a normal terminal instead." -ForegroundColor DarkGray
  }
}
