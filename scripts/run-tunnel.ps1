#requires -version 5

# Auto-restart wrapper for the ngrok tunnel.
# Restarts ngrok if it exits for any reason (network blip, crash, killed).
# Logs to logs\tunnel.log next to this script.

$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "tunnel.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Find-Ngrok {
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ngrok.exe",
        "C:\Program Files\ngrok\ngrok.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $cmd = Get-Command ngrok -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "ngrok not found. Install with: winget install --id Ngrok.Ngrok"
}

$ngrok = Find-Ngrok
$tunnelUrl = "https://swivel-debug-pummel.ngrok-free.dev"
$localPort = 3000
$backoffSeconds = 2

function Log-Line($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Log-Line "tunnel wrapper starting: $ngrok http --url=$tunnelUrl $localPort"

while ($true) {
    $startedAt = Get-Date
    try {
        & $ngrok http --url=$tunnelUrl $localPort --log=stdout 2>&1 |
            ForEach-Object { Add-Content -Path $logFile -Value $_ }
        $exitCode = $LASTEXITCODE
    } catch {
        $exitCode = -1
        Log-Line "exception: $($_.Exception.Message)"
    }

    $ranFor = (Get-Date) - $startedAt
    Log-Line "ngrok exited (code=$exitCode, ran for $([int]$ranFor.TotalSeconds)s); restarting in $backoffSeconds s"

    if ($ranFor.TotalSeconds -lt 10) {
        $backoffSeconds = [Math]::Min(60, $backoffSeconds * 2)
    } else {
        $backoffSeconds = 2
    }

    Start-Sleep -Seconds $backoffSeconds
}
