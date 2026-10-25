[CmdletBinding()]
param([string]$OutputDirectory, [ValidateRange(30, 300)][int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Actual Windows WPF is required; no runtime PASS was produced.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $PSScriptRoot ('../TestResults/windows-' + (Get-Date -Format 'yyyyMMddTHHmmss'))
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$resultPath = Join-Path $OutputDirectory 'wpf-results.json'
if (Test-Path $resultPath) { throw 'Use a new output directory; existing evidence will not be overwritten.' }
$env:CAIWU_VOUCHER_COPY_COMMIT = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify checkout commit.' }
$dirtySources = & git -C $root status --porcelain --untracked-files=all -- src/Caiwu.Contracts src/Caiwu.Core src/Caiwu.VoucherTools src/Caiwu.VoucherTools.Wpf tests/Caiwu.ModuleWindowsQA/CopySummaryBook
if ($LASTEXITCODE -ne 0 -or $dirtySources) { throw 'Commit source changes before collecting immutable Windows evidence.' }
$project = Join-Path $PSScriptRoot 'Caiwu.VoucherTools.Wpf.Windows.Tests.csproj'
& dotnet build $project -c Release -warnaserror -p:RestoreLockedMode=true --nologo
if ($LASTEXITCODE -ne 0) { throw 'WPF runtime probe build failed.' }
$dll = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.VoucherTools.Wpf.Windows.Tests.dll'
$process = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.log')
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    throw "WPF runtime probes timed out after $TimeoutSeconds seconds; inspect partial logs, no PASS inferred."
}
if ($process.ExitCode -ne 0) { throw "WPF runtime probes failed ($($process.ExitCode)); inspect output logs and JSON." }
if (-not (Test-Path $resultPath)) { throw 'Probe returned without evidence JSON.' }
$result = Get-Content -Raw $resultPath | ConvertFrom-Json
if (-not $result.actualWindowsWpf -or $result.checkoutCommit -ne $env:CAIWU_VOUCHER_COPY_COMMIT -or $result.failures -ne 0 -or $result.results.Count -ne 12) {
    throw 'Evidence identity/count/status mismatch; no PASS inferred.'
}
Write-Output "Actual Windows WPF: 12 probes passed. Evidence: $resultPath"
