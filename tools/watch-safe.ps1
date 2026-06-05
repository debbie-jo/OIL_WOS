param(
  [int]$IntervalSeconds = 1
)

Write-Host "LDPlayer safe OCR watch started."
Write-Host "Keep the game on Alliance War > Rally tab."
Write-Host "Press Ctrl+C to stop."

npm.cmd run watch:publish
