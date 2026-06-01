# Generate legacy Android launcher PNGs from the OMT shield source icon.
# Usage: powershell -File scripts/generate-android-icons.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot

$Source = Join-Path $Root "client\public\icon-512.png"
$ResRoot = Join-Path $Root "android\app\src\main\res"

if (-not (Test-Path $Source)) {
    Write-Error "Missing source icon: $Source"
}

function Save-LauncherIcon {
    param(
        [int]$Size,
        [string]$OutPath
    )

    $src = [System.Drawing.Image]::FromFile($Source)
    try {
        $bmp = New-Object System.Drawing.Bitmap $Size, $Size
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.Clear([System.Drawing.Color]::White)

            $padding = [math]::Round($Size * 0.08)
            $inner = $Size - (2 * $padding)
            $g.DrawImage($src, $padding, $padding, $inner, $inner)

            $dir = Split-Path -Parent $OutPath
            if (-not (Test-Path $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $g.Dispose()
            $bmp.Dispose()
        }
    } finally {
        $src.Dispose()
    }
}

$densitySizes = @{
    "mipmap-mdpi"    = 48
    "mipmap-hdpi"    = 72
    "mipmap-xhdpi"   = 96
    "mipmap-xxhdpi"  = 144
    "mipmap-xxxhdpi" = 192
}

foreach ($folder in $densitySizes.Keys) {
    $size = $densitySizes[$folder]
    $base = Join-Path $ResRoot $folder
    Save-LauncherIcon -Size $size -OutPath (Join-Path $base "ic_launcher.png")
    Save-LauncherIcon -Size $size -OutPath (Join-Path $base "ic_launcher_round.png")
    Save-LauncherIcon -Size $size -OutPath (Join-Path $base "ic_launcher_foreground.png")
    Write-Host "Wrote $folder ($size px)"
}

Write-Host "Android launcher icons generated."
