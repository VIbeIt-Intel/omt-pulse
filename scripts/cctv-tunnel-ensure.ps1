# If the CCTV SSH tunnel is not running, start the scheduled tunnel task.
# Safe to run every few minutes from Task Scheduler.

param(
  [string]$TaskName = "OMT-Pulse-CCTV-Tunnel",
  [int]$RemoteRtspPort = 8554
)

$ErrorActionPreference = "SilentlyContinue"

function Test-TunnelSshRunning {
  foreach ($p in Get-CimInstance Win32_Process -Filter "Name='ssh.exe'") {
    $cmd = $p.CommandLine
    if ($cmd -and $cmd -match "-R\s+${RemoteRtspPort}:") {
      return $true
    }
  }
  return $false
}

if (Test-TunnelSshRunning) {
  exit 0
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "[cctv-tunnel-ensure] Task '$TaskName' not installed. Run install-cctv-tunnel-autostart.ps1"
  exit 1
}

Write-Host "[$(Get-Date -Format 'HH:mm:ss')] CCTV tunnel SSH not found - starting $TaskName"
Start-ScheduledTask -TaskName $TaskName
exit 0
