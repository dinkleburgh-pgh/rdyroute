<#
.SYNOPSIS
    Redeploy the production `rdyroute2` Portainer stack (pulls the latest image).

.DESCRIPTION
    Loads the PORTAINER_* credentials from production.env into the environment,
    then invokes `docker_resolve.py portainer_redeploy`, which talks to the
    Portainer HTTP API. The redeploy preserves the stack's existing env vars and
    sets pullImage=true. Scoped to ONLY the redeploy action.

.EXAMPLE
    .\redeploy-prod.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Get-Content (Join-Path $PSScriptRoot 'production.env') |
    Where-Object { $_ -match '^\s*PORTAINER_[A-Z_]+\s*=' -and $_ -notmatch '^\s*#' } |
    ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') {
            Set-Item -Path "env:$($matches[1])" -Value $matches[2].Trim()
        }
    }

# docker_resolve.py prints unicode (→) — force UTF-8 so the Windows cp1252
# console doesn't crash on it.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
python docker_resolve.py portainer_redeploy
