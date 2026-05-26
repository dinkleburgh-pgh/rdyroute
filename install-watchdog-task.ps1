param(
    [ValidateSet("auto", "local", "dev", "prod")]
    [string]$Mode = "auto"
)

$runName = "ReadyRouteWatchdog"
$scriptPath = Join-Path $PSScriptRoot "watchdog.ps1"

if (-not (Test-Path $scriptPath)) {
    throw "watchdog.ps1 not found at $scriptPath"
}

$command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode $Mode -Silent"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

Set-ItemProperty -Path $runKey -Name $runName -Value $command

# Replace any currently running watchdog process so mode changes apply now.
$existing = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -ieq "powershell.exe" -and $_.CommandLine -match "watchdog.ps1"
}
foreach ($p in $existing) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    }
    catch {
        # Ignore best-effort shutdown failures.
    }
}

# Start now (in addition to auto-start at sign-in).
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $scriptPath, "-Mode", $Mode, "-Silent"

Write-Host "Installed and started watchdog startup entry '$runName' in mode '$Mode'."
