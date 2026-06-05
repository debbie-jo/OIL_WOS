param(
  [string]$OutFile,
  [string]$TitlePattern = "White|LDPlayer|dnplayer|LDMultiplayer",
  [string]$ProcessPattern = "dnplayer|Ld9BoxHeadless|HD-Player",
  [int]$CropTop = 70,
  [int]$CropBottom = 35,
  [int]$CropLeft = 0,
  [int]$CropRight = 0
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32Capture {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
"@

if (-not $OutFile) {
  throw "OutFile is required."
}

$script:candidates = New-Object System.Collections.ArrayList
[Win32Capture]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32Capture]::IsWindowVisible($hWnd)) { return $true }
  $builder = New-Object System.Text.StringBuilder 512
  [void][Win32Capture]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString()
  $pidValue = [uint32]0
  [void][Win32Capture]::GetWindowThreadProcessId($hWnd, [ref]$pidValue)
  $procName = ""
  try {
    $procName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName
  } catch {
    $procName = ""
  }

  if (($title -and ($title -match $TitlePattern)) -or ($procName -and ($procName -match $ProcessPattern))) {
    $candidateRect = New-Object Win32Capture+RECT
    [void][Win32Capture]::GetWindowRect($hWnd, [ref]$candidateRect)
    $candidateWidth = $candidateRect.Right - $candidateRect.Left
    $candidateHeight = $candidateRect.Bottom - $candidateRect.Top
    if ($candidateWidth -ge 300 -and $candidateHeight -ge 400) {
      [void]$script:candidates.Add([pscustomobject]@{
        Handle = $hWnd
        ProcessId = $pidValue
        ProcessName = $procName
        Title = $title
        Width = $candidateWidth
        Height = $candidateHeight
        Area = $candidateWidth * $candidateHeight
      })
    }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null

$selected = $script:candidates | Sort-Object Area -Descending | Select-Object -First 1
if ($selected) {
  $target = $selected.Handle
  $targetProcessId = $selected.ProcessId
} else {
  $target = [IntPtr]::Zero
  $targetProcessId = 0
}

if ($target -eq [IntPtr]::Zero) {
  throw "LDPlayer window was not found. Keep LDPlayer open and visible."
}

[void][Win32Capture]::ShowWindow($target, 9)
[void][Win32Capture]::SetForegroundWindow($target)
try {
  $shell = New-Object -ComObject WScript.Shell
  [void]$shell.AppActivate([int]$targetProcessId)
} catch {}
[void][Win32Capture]::ShowWindow($target, 9)
[void][Win32Capture]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 1500

$rect = New-Object Win32Capture+RECT
[void][Win32Capture]::GetWindowRect($target, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
  throw "LDPlayer window size is invalid."
}

$cropX = [Math]::Max(0, $CropLeft)
$cropY = [Math]::Max(0, $CropTop)
$cropWidth = [Math]::Max(1, $width - $CropLeft - $CropRight)
$cropHeight = [Math]::Max(1, $height - $CropTop - $CropBottom)

$bitmap = New-Object System.Drawing.Bitmap $cropWidth, $cropHeight
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left + $cropX, $rect.Top + $cropY, 0, 0, $bitmap.Size)

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}

$bitmap.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $OutFile
