#requires -version 5

# Auto-restart wrapper for the Next.js dev server.
# Restarts npm run dev if it exits for any reason.
# Logs to logs\dev.log next to this script.

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "dev.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$nodePath = "C:\Program Files\nodejs"
if (Test-Path $nodePath) {
    $env:PATH = "$nodePath;$env:PATH"
}

$backoffSeconds = 2

function Log-Line($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Set-Location $root
Log-Line "dev wrapper starting in $root"

while ($true) {
    $startedAt = Get-Date
    try {
        npm run dev 2>&1 |
            ForEach-Object { Add-Content -Path $logFile -Value $_ }
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = -1
        Log-Line "exception: $($_.Exception.Message)"
    }

    $ranFor = (Get-Date) - $startedAt
    Log-Line "dev server exited (code=$exitCode, ran for $([int]$ranFor.TotalSeconds)s); restarting in $backoffSeconds s"

    if ($ranFor.TotalSeconds -lt 10) {
        $backoffSeconds = [Math]::Min(60, $backoffSeconds * 2)
    } else {
        $backoffSeconds = 2
    }

    Start-Sleep -Seconds $backoffSeconds
}
