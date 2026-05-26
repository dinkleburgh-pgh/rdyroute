<#
.SYNOPSIS
    Pull the latest ReadyRoute V2 container images and restart the stack.

.DESCRIPTION
    Uses docker compose with docker-compose.prod.yml plus the local production env file.
    The backend database lives in the named backend_data volume, so repulls do
    not wipe application data.

.EXAMPLE
    .\deploy.ps1
#>

[CmdletBinding()]
param(
    [switch]$Recreate
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$composeArgs = @('--env-file', '.env.production', '-f', 'docker-compose.prod.yml')

docker compose @composeArgs pull

$upArgs = @('--env-file', '.env.production', '-f', 'docker-compose.prod.yml', 'up', '-d', '--remove-orphans')
if ($Recreate) {
    $upArgs += '--force-recreate'
}

docker compose @upArgs
docker compose @composeArgs ps