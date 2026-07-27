# Forward EZVIZ (or any LAN RTSP camera) to the OMT Pulse VPS via SSH reverse tunnel.
# Keep this window open while dispatch watches the stream on omtpulse.com / the app.
#
# 1. Camera RTSP in OMT admin must use: rtsp://127.0.0.1:<RemotePort>/Streaming/Channels/101
#    (credentials admin + device code stay in OMT as today)
# 2. PC must be on the same network as the camera.

param(
  [string]$CameraHost = "192.168.0.168",
  [int]$CameraPort = 554,
  [int]$RemotePort = 8554,
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
Write-Host "OMT CCTV LAN tunnel"
Write-Host "  Camera:  ${CameraHost}:${CameraPort}"
Write-Host "  On VPS:  127.0.0.1:${RemotePort}  (set OMT RTSP URL to this host/port)"
Write-Host "  SSH:     $SshHost"
Write-Host ""
Write-Host "Leave this running. Press Ctrl+C to stop the tunnel."
Write-Host ""

$bind = "${RemotePort}:${CameraHost}:${CameraPort}"
ssh -i $SshKey -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N -R $bind $SshHost
