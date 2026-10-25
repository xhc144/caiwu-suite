[CmdletBinding()]
param([string]$OutputDirectory = 'artifacts/native-focus')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'BLOCKED: native Windows keyboard focus validation required.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
& git -C $root diff --quiet HEAD -- src
if ($LASTEXITCODE -ne 0) { throw 'Production source contains uncommitted edits.' }
$env:CAIWU_REVALIDATION_COMMIT = (& git -C $root rev-parse HEAD).Trim()
$env:CAIWU_FOCUS_SOURCE_TREE = (& git -C $root rev-parse 'HEAD:src').Trim()
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.NativeFocus.csproj') -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Native focus harness failed to build.' }
$resultPath = Join-Path $OutputDirectory 'native-focus-results.json'
if (Test-Path $resultPath) { Remove-Item $resultPath }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.Acceptance.NativeFocus.dll'
$process = Start-Process (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $process.WaitForExit(90000)) { $process.Kill($true); throw 'BLOCKED: native focus scenario timed out; no pass inferred.' }
if ($process.ExitCode -ne 0) { throw 'Native focus scenario failed or was blocked; inspect results and logs.' }
$result = Get-Content -Raw $resultPath | ConvertFrom-Json
$expected = @('F4-CANCEL-RETAINS-FOCUS-INPUT', 'F4-ACCEPT-NEXT-CELL-NATIVE-INPUT')
if ($result.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or $result.productionSourceTree -ne $env:CAIWU_FOCUS_SOURCE_TREE -or -not $result.actualWindowsWpf -or -not $result.nativeKeyboardInput -or $result.results.Count -ne 2 -or $result.failures -ne 0) { throw 'Native focus result identity/count/status mismatch.' }
foreach ($id in $expected) {
    $matches = @($result.results | Where-Object { $_.id -eq $id -and $_.status -eq 'PASS' })
    if ($matches.Count -ne 1) { throw "Missing unique native focus pass: $id" }
}
