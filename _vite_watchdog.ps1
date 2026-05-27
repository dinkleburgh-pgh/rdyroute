<#
.SYNOPSIS
    Watchdog that keeps the Vite dev server alive — auto-restarts on crash.
    Launched by run.ps1 via dot-source after setting required variables:
      $NpmCmd, $FrontendDir, $FrontendPort, $LogFile, $SentinelFile
    Not intended to be run directly.

.NOTES
    Hardening (post-incident 2026-05-27):
      * Launch via cmd.exe /c so Start-Process never trips over .cmd resolution.
      * Per-attempt rotating log file (.vite.N.log) — prevents "file in use"
        errors from the previous Vite still flushing to the old log.
      * Circuit breaker: if Vite dies < 10s after starting, count it as a
        rapid failure. After 5 consecutive rapid failures, back off to 60s
        between attempts (instead of the normal 3s) so we don't burn CPU.
      * Resets the rapid-failure counter once Vite has stayed alive ≥ 30s.
#>

function Write-Log {
    param([string]$Msg)
    $ts = Get-Date -Format 'HH:mm:ss'
    # Retry briefly if the log file is momentarily locked by another writer.
    for ($i = 0; $i -lt 5; $i++) {
        try { Add-Content -Path $LogFile -Value "[$ts WATCHDOG] $Msg" -ErrorAction Stop; return }
        catch { Start-Sleep -Milliseconds 100 }
    }
}

$script:Attempt = 0

function Start-Vite {
    $script:Attempt++
    $viteOut = "$LogFile.vite.$($script:Attempt).log"
    $viteErr = "$LogFile.vite.$($script:Attempt).err"
    # Keep only the most recent 5 attempt logs to avoid unbounded files.
    Get-ChildItem -Path (Split-Path $LogFile -Parent) -Filter (Split-Path "$LogFile.vite.*.log" -Leaf) -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path (Split-Path $LogFile -Parent) -Filter (Split-Path "$LogFile.vite.*.err" -Leaf) -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip 5 |
        Remove-Item -Force -ErrorAction SilentlyContinue

    try {
        # cmd.exe /c bypasses Start-Process's flaky .cmd handling.
        $cmdLine = "`"$NpmCmd`" run dev -- --port $FrontendPort"
        $p = Start-Process -FilePath 'cmd.exe' `
            -ArgumentList @('/c', $cmdLine) `
            -WorkingDirectory $FrontendDir `
            -RedirectStandardOutput $viteOut `
            -RedirectStandardError $viteErr `
            -WindowStyle Hidden -PassThru
        return @{ Proc = $p; StartedAt = Get-Date; OutLog = $viteOut; ErrLog = $viteErr }
    } catch {
        Write-Log "Start-Vite error: $_"
        return $null
    }
}

$state = Start-Vite
if ($state) {
    Write-Log "Started (PID $($state.Proc.Id), log $($state.OutLog))"
} else {
    Write-Log "Initial start failed."
}

$rapidFailures = 0
$backoffSeconds = 3

while (Test-Path $SentinelFile) {
    Start-Sleep -Seconds 5
    if (-not (Test-Path $SentinelFile)) { break }

    $proc = if ($state) { $state.Proc } else { $null }
    $exited = ($null -eq $proc) -or $proc.HasExited

    if (-not $exited) {
        # Healthy — reset rapid-failure counter once vite has been up ≥ 30s.
        if ((Get-Date) - $state.StartedAt -gt [TimeSpan]::FromSeconds(30) -and $rapidFailures -gt 0) {
            Write-Log "Vite stable for 30s — resetting rapid-failure counter."
            $rapidFailures = 0
            $backoffSeconds = 3
        }
        continue
    }

    # Vite exited — diagnose and decide whether to restart.
    $code = if ($null -ne $proc) { $proc.ExitCode } else { 'null' }
    $aliveFor = if ($state) { ((Get-Date) - $state.StartedAt).TotalSeconds } else { 0 }
    $errTail = ''
    if ($state -and (Test-Path $state.ErrLog)) {
        try { $errTail = (Get-Content $state.ErrLog -Tail 3 -ErrorAction SilentlyContinue) -join ' | ' } catch {}
    }
    Write-Log ("Vite exited (code {0}, alive {1:N1}s). stderr-tail: {2}" -f $code, $aliveFor, $errTail)

    if ($aliveFor -lt 10) {
        $rapidFailures++
        if ($rapidFailures -ge 5) {
            $backoffSeconds = 60
            Write-Log "Rapid failures = $rapidFailures — backing off to ${backoffSeconds}s between attempts."
        }
    } else {
        $rapidFailures = 0
        $backoffSeconds = 3
    }

    Write-Log "Restarting in ${backoffSeconds}s..."
    Start-Sleep -Seconds $backoffSeconds
    if (-not (Test-Path $SentinelFile)) { break }

    $state = Start-Vite
    if ($state) {
        Write-Log "Vite restarted (PID $($state.Proc.Id), log $($state.OutLog))."
    } else {
        Write-Log "Restart failed — will retry on next cycle."
    }
}

# Sentinel removed — stop Vite gracefully
Write-Log "Sentinel removed. Stopping Vite..."
if ($state -and $state.Proc -and -not $state.Proc.HasExited) {
    Stop-Process -Id $state.Proc.Id -Force -ErrorAction SilentlyContinue
}
Write-Log "Done."
