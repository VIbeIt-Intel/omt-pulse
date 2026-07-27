# Forward EZVIZ (or LAN camera) RTSP + HTTP (PTZ) to OMT Pulse VPS via SSH reverse tunnels.
# Keep this window open while using omtpulse.com / the app.
#
# OMT camera RTSP URL: rtsp://127.0.0.1:8554/Streaming/Channels/101
# PTZ uses HTTP on the VPS at 127.0.0.1:8555 (→ camera port 80)

param(
  [string]$CameraHost = "192.168.0.168",
  [int]$CameraRtspPort = 554,
  [int]$CameraHttpPort = 80,
  [int]$RemoteRtspPort = 8554,
  [int]$RemotePtzPort = 8555,
  [string]$SshHost = "ubuntu@154.65.108.187",
  [string]$SshKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $SshKey) {
  $candidates = @(
    "$env:USERPROFILE\.ssh\omt-pulse-recovery",
    "$env:USERPROFILE\.ssh\omt-pulse-access.pem",
    "$env:USERPROFILE\Downloads\omt-pulse-access.pem"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { $SshKey = $c; break }
  }
}

if (-not $SshKey -or -not (Test-Path $SshKey)) {
  Write-Host "SSH key not found. Pass -SshKey path to omt-pulse-recovery / access.pem"
  exit 1
}

Write-Host ""
Write-Host "OMT CCTV LAN tunnels"
Write-Host "  RTSP  ${CameraHost}:${CameraRtspPort} -> VPS 127.0.0.1:${RemoteRtspPort}"
Write-Host "  HTTP  ${CameraHost}:${CameraHttpPort} -> VPS 127.0.0.1:${RemotePtzPort} (PTZ / ISAPI)"
Write-Host "  HTTP  ${CameraHost}:8000 -> VPS 127.0.0.1:8556 (PTZ alt port)"
Write-Host "  SSH:   $SshHost"
Write-Host ""
Write-Host "Leave this running. Press Ctrl+C to stop."
Write-Host ""

ssh -i $SshKey -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N `
  -R "${RemoteRtspPort}:${CameraHost}:${CameraRtspPort}" `
  -R "${RemotePtzPort}:${CameraHost}:${CameraHttpPort}" `
  -R "8556:${CameraHost}:8000" `
  $SshHost
