[CmdletBinding()]
param([string]$OutputDirectory, [ValidateRange(30, 180)][int]$TimeoutSeconds = 90)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Visual review requires actual Windows WPF. No screenshots produced.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'artifacts/verification/modern' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:CAIWU_VISUAL_COMMIT = (& git -C $root rev-parse HEAD).Trim()
$env:CAIWU_VISUAL_SOURCE_TREE = (& git -C $root rev-parse HEAD:src).Trim()
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.VisualReview.csproj') -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Visual harness did not compile.' }
$resultPath = Join-Path $OutputDirectory 'visual-review.json'
if (Test-Path $resultPath) { Remove-Item $resultPath }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.VisualReview.dll'
$p = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $p.WaitForExit($TimeoutSeconds * 1000)) { $p.Kill($true); throw 'Visual harness timed out; inspect partial PNGs and logs. No pass inferred.' }
if ($p.ExitCode -ne 0 -or -not (Test-Path $resultPath)) { throw 'Visual harness failed; inspect visual-review.json and logs.' }
$r = Get-Content -Raw $resultPath | ConvertFrom-Json
if (-not $r.success -or -not $r.actualWindowsWpf -or $r.checkoutCommit -ne $env:CAIWU_VISUAL_COMMIT -or $r.screenshots.Count -ne 6) { throw 'Visual evidence identity/count/status mismatch.' }
foreach ($capture in $r.screenshots) {
    if ($capture.width -lt 1920 -or $capture.height -lt 1080) { throw 'Native screenshot resolution is insufficient.' }
    $actual = (Get-FileHash (Join-Path $OutputDirectory $capture.file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $capture.sha256) { throw 'Screenshot SHA256 mismatch.' }
}
Write-Output "Native visual evidence: $resultPath"
