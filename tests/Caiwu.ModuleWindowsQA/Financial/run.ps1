[CmdletBinding()]
param([string]$OutputDirectory = 'artifacts/financial-windows')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Actual Windows desktop required; cross compilation is not UI acceptance.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$env:CAIWU_QA_SHA = (& git -C $root rev-parse HEAD).Trim()
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.ModuleWindowsQA.Financial.csproj') -c Release --nologo -p:RestoreLockedMode=true -p:TreatWarningsAsErrors=true
if ($LASTEXITCODE -ne 0) { throw 'Financial component host failed to build.' }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.ModuleWindowsQA.Financial.dll'
$process = Start-Process (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $process.WaitForExit(210000)) { $process.Kill($true); throw 'Single financial QA process exceeded 210 seconds. No pass inferred.' }
if ($process.ExitCode -ne 0) { throw "Actual financial QA failed (exit $($process.ExitCode)); inspect JSON/PNG/log evidence." }
$result = Get-Content -Raw (Join-Path $OutputDirectory 'financial-results.json') | ConvertFrom-Json
if (-not $result.passed -or $result.sourceSha -ne $env:CAIWU_QA_SHA -or $result.cases.Count -ne 3) { throw 'Result/SHA/case identity mismatch.' }
foreach ($capture in $result.captures) {
    if ((Get-FileHash (Join-Path $OutputDirectory $capture.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $capture.sha256) { throw 'PNG hash mismatch.' }
}
