param(
  [Parameter(Mandatory = $true)]
  [string]$InFile,

  [Parameter(Mandatory = $true)]
  [string]$OutFile,

  [Parameter(Mandatory = $true)]
  [int]$Left,

  [Parameter(Mandatory = $true)]
  [int]$Top,

  [Parameter(Mandatory = $true)]
  [int]$Width,

  [Parameter(Mandatory = $true)]
  [int]$Height,

  [int]$Scale = 3
)

Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path $InFile).Path
$outDir = Split-Path -Parent $OutFile
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  $safeLeft = [Math]::Max(0, [Math]::Min($Left, $source.Width - 1))
  $safeTop = [Math]::Max(0, [Math]::Min($Top, $source.Height - 1))
  $safeWidth = [Math]::Max(1, [Math]::Min($Width, $source.Width - $safeLeft))
  $safeHeight = [Math]::Max(1, [Math]::Min($Height, $source.Height - $safeTop))
  $safeScale = [Math]::Max(1, $Scale)

  $cropRect = New-Object System.Drawing.Rectangle($safeLeft, $safeTop, $safeWidth, $safeHeight)
  $crop = $source.Clone($cropRect, $source.PixelFormat)
  try {
    $scaled = New-Object System.Drawing.Bitmap($($safeWidth * $safeScale), $($safeHeight * $safeScale))
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($scaled)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.DrawImage($crop, 0, 0, $scaled.Width, $scaled.Height)
      } finally {
        $graphics.Dispose()
      }

      $scaled.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $scaled.Dispose()
    }
  } finally {
    $crop.Dispose()
  }
} finally {
  $source.Dispose()
}
