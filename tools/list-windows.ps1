Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32WindowList {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

[Win32WindowList]::EnumWindows({
  param($hWnd, $lParam)
  if (-not [Win32WindowList]::IsWindowVisible($hWnd)) { return $true }
  $builder = New-Object System.Text.StringBuilder 512
  [void][Win32WindowList]::GetWindowText($hWnd, $builder, $builder.Capacity)
  $title = $builder.ToString()
  $pidValue = [uint32]0
  [void][Win32WindowList]::GetWindowThreadProcessId($hWnd, [ref]$pidValue)
  try {
    $proc = Get-Process -Id $pidValue -ErrorAction Stop
    if ($title -or $proc.ProcessName -match "dn|ld|player|chrome|code") {
      [pscustomobject]@{
        Process = $proc.ProcessName
        Id = $pidValue
        Title = $title
      }
    }
  } catch {}
  return $true
}, [IntPtr]::Zero) | Format-Table -AutoSize
