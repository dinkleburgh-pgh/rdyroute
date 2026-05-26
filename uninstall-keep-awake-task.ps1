$taskName = "ReadyRoute Keep Awake"
$runName = "ReadyRouteKeepAwake"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'."
}

if (Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $runKey -Name $runName
    Write-Host "Removed startup entry '$runName'."
}
else {
    Write-Host "Startup entry '$runName' was not found."
}