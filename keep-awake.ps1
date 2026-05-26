param(
    [switch]$KeepDisplayOn,
    [int]$Minutes = 0,
    [switch]$Silent
)

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class SleepUtil {
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

Add-Type -TypeDefinition $signature

$ES_CONTINUOUS = 0x80000000
$ES_SYSTEM_REQUIRED = 0x00000001
$ES_DISPLAY_REQUIRED = 0x00000002

$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED
if ($KeepDisplayOn) {
    $flags = $flags -bor $ES_DISPLAY_REQUIRED
}

[void][SleepUtil]::SetThreadExecutionState($flags)

$mode = if ($KeepDisplayOn) { "system and display" } else { "system" }

function Write-Status([string]$Message) {
    if (-not $Silent) {
        Write-Host $Message
    }
}

try {
    if ($Minutes -gt 0) {
        Write-Status "Preventing $mode sleep for $Minutes minute(s). Press Ctrl+C to stop early."
        $end = (Get-Date).AddMinutes($Minutes)
        while ((Get-Date) -lt $end) {
            Start-Sleep -Seconds 30
            [void][SleepUtil]::SetThreadExecutionState($flags)
        }
    }
    else {
        Write-Status "Preventing $mode sleep until this window closes. Press Ctrl+C to stop."
        while ($true) {
            Start-Sleep -Seconds 30
            [void][SleepUtil]::SetThreadExecutionState($flags)
        }
    }
}
finally {
    [void][SleepUtil]::SetThreadExecutionState($ES_CONTINUOUS)
    Write-Status "Sleep settings restored for this session."
}