[CmdletBinding()]
param([string]$OutputDirectory = 'artifacts/mutation-windows')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'BLOCKED: actual Windows WPF/native dialogs required.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$env:CAIWU_REVALIDATION_COMMIT = (& git -C $root rev-parse HEAD).Trim()
& git -C $root diff --quiet HEAD -- src packaging-next/src
if ($LASTEXITCODE -ne 0) { throw 'Production source identity is dirty.' }
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.MutationWindows.csproj') -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Mutation Windows probe failed to compile.' }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.Acceptance.MutationWindows.dll'
$process = Start-Process (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $process.WaitForExit(150000)) { $process.Kill($true); throw 'Mutation UI probes timed out; no passing result inferred.' }
if ($process.ExitCode -ne 0) { throw 'Mutation UI probes failed; inspect results/logs.' }
$result = Get-Content -Raw (Join-Path $OutputDirectory 'mutation-windows-results.json') | ConvertFrom-Json
$expected = @('OPENING', 'ACCOUNT', 'DELETE', 'REVIEW', 'POST', 'SAME-IDENTITY-RESTORE')
if ($result.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or -not $result.actualWindowsWpf -or $result.failures -ne 0 -or $result.results.Count -ne 6 -or @(Compare-Object $expected @($result.results | ForEach-Object { $_.id })).Count -ne 0 -or @($result.results | Where-Object { $_.status -ne 'PASS' }).Count -ne 0) { throw 'Mutation UI source/case/status mismatch.' }
