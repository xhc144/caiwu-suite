[CmdletBinding()]
param([string]$OutputDirectory = 'artifacts/high-resolution')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'BLOCKED: actual Windows desktop capture required.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$env:CAIWU_REVALIDATION_COMMIT = (& git -C $root rev-parse HEAD).Trim()
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.HighResolution.csproj') -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Screenshot harness failed to build.' }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.Acceptance.HighResolution.dll'
$process = Start-Process (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $process.WaitForExit(90000)) { $process.Kill($true); throw 'Desktop screenshot probe timed out; no capture pass inferred.' }
if ($process.ExitCode -ne 0) { throw 'Native desktop capture failed or was blocked; inspect capture-failure.txt.' }
$result = Get-Content -Raw (Join-Path $OutputDirectory 'screenshots.json') | ConvertFrom-Json
if ($result.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or $result.captures.Count -ne 4 -or $result.resizedOrUpscaled -or -not $result.actualWindowsDesktop) { throw 'Screenshot identity/count mismatch.' }
foreach ($capture in $result.captures) {
    if ($capture.width -lt 1920 -or $capture.height -lt 1080) { throw 'Native screenshot dimensions below requested minimum.' }
    if ((Get-FileHash (Join-Path $OutputDirectory $capture.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $capture.sha256) { throw 'Screenshot hash mismatch.' }
}
