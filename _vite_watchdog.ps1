<#
.SYNOPSIS
    Watchdog that keeps the Vite dev server alive — auto-restarts on crash.
    Launched by run.ps1 via dot-source after setting required variables:
      $NpmCmd, $FrontendDir, $FrontendPort, $LogFile, $SentinelFile
    Not intended to be run directly.
#>

function Start-Vite {
    try {
        # Use -NoNewWindow (not -WindowStyle Hidden) — more reliable when parent is already hidden.
        # Redirect Vite output to a separate .vite log so Add-Content calls below don't conflict.
        $p = Start-Process -FilePath $NpmCmd `
            -ArgumentList @('run', 'dev', '--', '--port', $FrontendPort) `
            -WorkingDirectory $FrontendDir `
            -RedirectStandardOutput "$LogFile.vite" `
            -RedirectStandardError "$LogFile.vite.err" `
            -NoNewWindow -PassThru
        return $p
    } catch {
        $ts = Get-Date -Format 'HH:mm:ss'
        Add-Content $LogFile "[$ts WATCHDOG] Start-Vite error: $_"
        return $null
    }
}

$viteProc = Start-Vite
$ts = Get-Date -Format 'HH:mm:ss'
Add-Content $LogFile "[$ts WATCHDOG] Started (PID $($viteProc.Id))"

while (Test-Path $SentinelFile) {
    Start-Sleep -Seconds 5
    if (-not (Test-Path $SentinelFile)) { break }

    if ($null -eq $viteProc -or $viteProc.HasExited) {
        $ts = Get-Date -Format 'HH:mm:ss'
        $code = if ($null -ne $viteProc) { $viteProc.ExitCode } else { 'null' }
        Add-Content $LogFile "[$ts WATCHDOG] Vite exited (code $code). Restarting in 3s..."
        Start-Sleep -Seconds 3

        if (Test-Path $SentinelFile) {
            $viteProc = Start-Vite
            $ts = Get-Date -Format 'HH:mm:ss'
            Add-Content $LogFile "[$ts WATCHDOG] Vite restarted (PID $($viteProc.Id))."
        }
    }
}

# Sentinel removed — stop Vite gracefully
$ts = Get-Date -Format 'HH:mm:ss'
Add-Content $LogFile "[$ts WATCHDOG] Sentinel removed. Stopping Vite..."
if ($null -ne $viteProc -and -not $viteProc.HasExited) {
    Stop-Process -Id $viteProc.Id -Force -ErrorAction SilentlyContinue
}
Add-Content $LogFile "[$ts WATCHDOG] Done."
