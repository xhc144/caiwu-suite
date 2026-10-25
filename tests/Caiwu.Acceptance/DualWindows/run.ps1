[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Two-process WPF validation requires Windows.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'artifacts/dual-windows' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:CAIWU_REVALIDATION_COMMIT = (& git -C $root rev-parse HEAD).Trim()
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.DualWindows.csproj') -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Dual Windows harness did not build.' }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.Acceptance.DualWindows.dll'
$process = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'parent.stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'parent.stderr.log')
if (-not $process.WaitForExit(150000)) { $process.Kill($true); throw 'Two-process Windows test timed out; no passing result inferred.' }
if ($process.ExitCode -ne 0) { throw 'Two-process Windows validation failed; read dual-windows-results.json and per-process logs.' }
$result = Get-Content -Raw (Join-Path $OutputDirectory 'dual-windows-results.json') | ConvertFrom-Json
if ($result.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or $result.results.Count -ne 3 -or $result.failed -ne 0) { throw 'Dual-window result identity/count/status mismatch.' }
