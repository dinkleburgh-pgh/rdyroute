$runName = "ReadyRouteKeepAwake"
$scriptPath = Join-Path $PSScriptRoot "keep-awake.ps1"

if (-not (Test-Path $scriptPath)) {
    throw "keep-awake.ps1 not found at $scriptPath"
}

$command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -KeepDisplayOn -Silent"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

Set-ItemProperty -Path $runKey -Name $runName -Value $command
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $scriptPath, "-KeepDisplayOn", "-Silent"

Write-Host "Installed and started startup entry '$runName'."
