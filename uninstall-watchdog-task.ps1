$runName = "ReadyRouteWatchdog"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name $runName
    Write-Host "Removed startup entry '$runName'."
}
else {
    Write-Host "Startup entry '$runName' was not found."
}

# Best-effort stop for currently running watchdog process(es).
$matches = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq "powershell.exe" -and $_.CommandLine -match "watchdog.ps1"
}
foreach ($p in $matches) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    }
    catch {
        # Ignore best-effort shutdown failures.
    }
}
