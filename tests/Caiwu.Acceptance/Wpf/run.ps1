[CmdletBinding()]
param([string]$OutputDirectory, [ValidateRange(30, 300)][int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $IsWindows) { throw 'Independent WPF probes require actual Windows; no execution result produced.' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'tests/Caiwu.Acceptance/evidence/runtime/wpf' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:CAIWU_ACCEPTANCE_CHECKOUT_COMMIT = (& git -C $root rev-parse HEAD).Trim()
$env:CAIWU_ACCEPTANCE_SOURCE_TREE = (& git -C $root rev-parse 'HEAD:src').Trim()
$resultPath = Join-Path $OutputDirectory 'wpf-results.json'
if (Test-Path $resultPath) { Remove-Item $resultPath }
$build = Join-Path $root 'tests/Caiwu.Acceptance/.build'
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.Wpf.csproj') -c Release --artifacts-path $build --nologo
if ($LASTEXITCODE -ne 0) { throw 'Independent WPF harness build failed.' }
$dll = Join-Path $build 'bin/Caiwu.Acceptance.Wpf/release/Caiwu.Acceptance.Wpf.dll'
$process = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $OutputDirectory + '"')) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'wpf.stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'wpf.stderr.log')
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    [ordered]@{ status = 'BLOCKED'; action = 'Execute actual Windows WPF probes'; reason = "Runner timeout after $TimeoutSeconds seconds; no passing result inferred."; checkoutCommit = $env:CAIWU_ACCEPTANCE_CHECKOUT_COMMIT } | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'wpf-runner-timeout.json') -Encoding utf8
    throw 'Independent WPF probes timed out; inspect logs/any partial evidence.'
}
if ($process.ExitCode -ne 0) { throw "Independent WPF probes failed or were blocked ($($process.ExitCode)); inspect wpf-results.json and logs." }
if (-not (Test-Path $resultPath)) { throw 'WPF process returned without its evidence JSON.' }
$result = Get-Content -Raw $resultPath | ConvertFrom-Json
if (-not $result.actualWindowsWpf -or $result.checkoutCommit -ne $env:CAIWU_ACCEPTANCE_CHECKOUT_COMMIT -or $result.results.Count -ne 7 -or $result.failures -ne 0 -or $result.blocked -ne 0) {
    throw 'WPF result identity/count/status mismatch; no passing result inferred.'
}
