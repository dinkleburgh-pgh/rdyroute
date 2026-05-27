param(
    [ValidateSet("auto", "local", "dev", "prod")]
    [string]$Mode = "auto",
    [int]$IntervalSeconds = 20,
    [int]$FailureThreshold = 3,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$prodComposeArgs = @("--env-file", ".env.production", "-f", "docker-compose.prod.yml")
$devComposeArgs = @("-f", "docker-compose.yml")

$globalBackendHealthUrl = $env:WATCHDOG_BACKEND_HEALTH_URL
$globalFrontendHealthUrl = $env:WATCHDOG_FRONTEND_HEALTH_URL

$backendFailures = 0
$frontendFailures = 0
$currentMode = ""

function Write-Status([string]$Message) {
    if (-not $Silent) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Write-Host "[$ts] $Message"
    }
}

function Test-HttpHealthy([string]$Url) {
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 8 -UseBasicParsing
        return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400)
    }
    catch {
        return $false
    }
}

function Test-DockerServiceRunning([string[]]$Args, [string]$ServiceName) {
    try {
        $services = docker compose @Args ps --status running --services 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        return (($services -split "`r?`n") -contains $ServiceName)
    }
    catch {
        return $false
    }
}

function Restart-DockerService([string[]]$Args, [string]$ComposeLabel, [string]$ServiceName) {
    Write-Status "Restarting $ComposeLabel service '$ServiceName'..."
    docker compose @Args restart $ServiceName | Out-Null
}

function Restart-LocalStack {
    Write-Status "Restarting local stack via run.ps1..."
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run.ps1") -Restart -NoBrowser | Out-Null
}

function Ensure-KeepAwakeProcess {
    $keepAwake = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -ieq "powershell.exe" -and $_.CommandLine -match "keep-awake.ps1"
    }
    if ($keepAwake) { return }

    $keepAwakeScript = Join-Path $PSScriptRoot "keep-awake.ps1"
    if (-not (Test-Path $keepAwakeScript)) { return }

    Write-Status "keep-awake process missing; restarting it..."
    Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $keepAwakeScript, "-KeepDisplayOn", "-Silent"
}

function Get-EffectiveMode {
    if ($Mode -ne "auto") { return $Mode }

    if ((Test-DockerServiceRunning -Args $prodComposeArgs -ServiceName "backend") -or (Test-DockerServiceRunning -Args $prodComposeArgs -ServiceName "frontend")) {
        return "prod"
    }

    if ((Test-DockerServiceRunning -Args $devComposeArgs -ServiceName "backend") -or (Test-DockerServiceRunning -Args $devComposeArgs -ServiceName "frontend")) {
        return "dev"
    }

    return "local"
}

function Get-HealthUrls([string]$EffectiveMode) {
    if ($globalBackendHealthUrl -and $globalFrontendHealthUrl) {
        return @{ backend = $globalBackendHealthUrl; frontend = $globalFrontendHealthUrl }
    }

    switch ($EffectiveMode) {
        "prod" {
            return @{
                backend = if ($globalBackendHealthUrl) { $globalBackendHealthUrl } else { "http://127.0.0.1:8000/health" }
                frontend = if ($globalFrontendHealthUrl) { $globalFrontendHealthUrl } else { "http://127.0.0.1" }
            }
        }
        "dev" {
            return @{
                backend = if ($globalBackendHealthUrl) { $globalBackendHealthUrl } else { "http://127.0.0.1:8000/health" }
                frontend = if ($globalFrontendHealthUrl) { $globalFrontendHealthUrl } else { "http://127.0.0.1:5173" }
            }
        }
        default {
            return @{
                backend = if ($globalBackendHealthUrl) { $globalBackendHealthUrl } else { "http://127.0.0.1:8000/health" }
                frontend = if ($globalFrontendHealthUrl) { $globalFrontendHealthUrl } else { "http://127.0.0.1:5180" }
            }
        }
    }
}

Write-Status "Watchdog started in '$Mode' mode."

while ($true) {
    Ensure-KeepAwakeProcess

    $effectiveMode = Get-EffectiveMode

    if ($effectiveMode -ne $currentMode) {
        $currentMode = $effectiveMode
        $backendFailures = 0
        $frontendFailures = 0
        Write-Status "Switched to '$currentMode' environment mode."
    }

    $healthUrls = Get-HealthUrls -EffectiveMode $effectiveMode
    $backendHealthUrl = $healthUrls.backend
    $frontendHealthUrl = $healthUrls.frontend

    $backendOk = Test-HttpHealthy $backendHealthUrl
    $frontendOk = Test-HttpHealthy $frontendHealthUrl

    if ($backendOk) { $backendFailures = 0 } else { $backendFailures += 1 }
    if ($frontendOk) { $frontendFailures = 0 } else { $frontendFailures += 1 }

    switch ($effectiveMode) {
        "prod" {
            if ($backendFailures -ge $FailureThreshold) {
                Restart-DockerService -Args $prodComposeArgs -ComposeLabel "prod" -ServiceName "backend"
                $backendFailures = 0
            }
            if ($frontendFailures -ge $FailureThreshold) {
                Restart-DockerService -Args $prodComposeArgs -ComposeLabel "prod" -ServiceName "frontend"
                $frontendFailures = 0
            }
        }
        "dev" {
            if ($backendFailures -ge $FailureThreshold) {
                Restart-DockerService -Args $devComposeArgs -ComposeLabel "dev" -ServiceName "backend"
                $backendFailures = 0
            }
            if ($frontendFailures -ge $FailureThreshold) {
                Restart-DockerService -Args $devComposeArgs -ComposeLabel "dev" -ServiceName "frontend"
                $frontendFailures = 0
            }
        }
        default {
            if ($backendFailures -ge $FailureThreshold -or $frontendFailures -ge $FailureThreshold) {
                Restart-LocalStack
                $backendFailures = 0
                $frontendFailures = 0
            }
        }
    }

    Start-Sleep -Seconds $IntervalSeconds
}
