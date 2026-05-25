#requires -version 5

# Starts both the Next.js dev server and the ngrok tunnel in two new PowerShell
# windows, each with auto-restart on failure. Run this script once on login;
# the two windows will keep recruit-sms up and reachable.
#
# Usage:
#   .\scripts\start-all.ps1
#
# To stop everything: close both PowerShell windows.

$root = Split-Path -Parent $PSScriptRoot
$dev = Join-Path $PSScriptRoot "run-dev.ps1"
$tun = Join-Path $PSScriptRoot "run-tunnel.ps1"

Write-Host "Starting recruit-sms dev server (auto-restart)..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $dev -WorkingDirectory $root

Start-Sleep -Seconds 3

Write-Host "Starting ngrok tunnel (auto-restart)..."
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $tun -WorkingDirectory $root

Write-Host ""
Write-Host "Both processes are running in separate windows."
Write-Host "  Dev server: http://localhost:3000"
Write-Host "  Public URL: https://swivel-debug-pummel.ngrok-free.dev"
Write-Host ""
Write-Host "Logs are in $(Join-Path $root 'logs')\"
