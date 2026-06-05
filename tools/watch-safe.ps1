param(
  [int]$IntervalSeconds = 1
)

Write-Host "LDPlayer safe OCR watch started."
Write-Host "Keep the game on Alliance War > Rally tab."
Write-Host "Press Ctrl+C to stop."

while ($true) {
  npm.cmd run capture:safe
  npm.cmd run scan:publish
  Start-Sleep -Seconds $IntervalSeconds
}
