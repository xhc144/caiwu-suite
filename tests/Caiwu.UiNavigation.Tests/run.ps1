[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$ReviewedSourceRoot,
    [ValidateRange(30, 300)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'BLOCKED: actual Windows WPF/common dialogs required; no runtime pass produced.' }
$testRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if (-not $ReviewedSourceRoot) { $ReviewedSourceRoot = $testRoot }
$ReviewedSourceRoot = (Resolve-Path $ReviewedSourceRoot).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $testRoot 'artifacts/ui-navigation' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
& git -C $ReviewedSourceRoot diff --quiet HEAD -- src packaging-next/src
if ($LASTEXITCODE -ne 0) { throw 'Production sources have local edits; refusing ambiguous source identity.' }
$untracked = @(& git -C $ReviewedSourceRoot ls-files --others --exclude-standard -- src packaging-next/src)
if ($LASTEXITCODE -ne 0 -or $untracked.Count -ne 0) { throw 'Cannot establish clean production source identity (including untracked files).' }
$env:CAIWU_NAV_CHECKOUT_COMMIT = (& git -C $ReviewedSourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve reviewed checkout commit.' }
$env:CAIWU_NAV_SOURCE_TREE = (& git -C $ReviewedSourceRoot rev-parse 'HEAD:src').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve reviewed production source tree.' }
$env:CAIWU_NAV_DELIVERY_TREE = (& git -C $ReviewedSourceRoot rev-parse 'HEAD:packaging-next/src').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve reviewed delivery source tree.' }
$resultPath = Join-Path $OutputDirectory 'navigation-results.json'
if (Test-Path $resultPath) { Remove-Item $resultPath }
$build = Join-Path $OutputDirectory ('build-' + [guid]::NewGuid().ToString('N'))
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.UiNavigation.Tests.csproj') -c Release --artifacts-path $build "-p:ReviewedSourceRoot=$ReviewedSourceRoot" --nologo
if ($LASTEXITCODE -ne 0) { throw 'UI navigation harness did not compile.' }
$dll = Join-Path $build 'bin/Caiwu.UiNavigation.Tests/release/Caiwu.UiNavigation.Tests.dll'
$process = Start-Process -FilePath (Get-Command dotnet).Source -ArgumentList @(
    ('"' + $dll + '"'), ('"' + $OutputDirectory + '"')
) -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'navigation.stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'navigation.stderr.log')
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill($true)
    [ordered]@{
        status = 'BLOCKED'; action = 'Execute production Windows navigation probes'
        reason = "Process timeout after $TimeoutSeconds seconds; no passing result inferred."
        checkoutCommit = $env:CAIWU_NAV_CHECKOUT_COMMIT
    } | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'navigation-timeout.json') -Encoding utf8
    throw 'UI navigation probes timed out; inspect logs and partial screenshots.'
}
if (-not (Test-Path $resultPath)) { throw "Probe exited $($process.ExitCode) without navigation-results.json; no pass inferred." }
$result = Get-Content -Raw $resultPath | ConvertFrom-Json
$expectedIds = @('UI-NAV-NEWBOOK-CANCEL-RETAINS-INPUT', 'UI-NAV-REPORT-RETURN-RETAINS-CONTEXT')
$actualIds = @($result.results | ForEach-Object { $_.id })
if (-not $result.actualWindowsWpf -or $result.checkoutCommit -ne $env:CAIWU_NAV_CHECKOUT_COMMIT -or
    $result.productionSourceTree -ne $env:CAIWU_NAV_SOURCE_TREE -or $result.deliverySourceTree -ne $env:CAIWU_NAV_DELIVERY_TREE -or
    $actualIds.Count -ne 2 -or @(Compare-Object $expectedIds $actualIds).Count -ne 0) {
    throw 'Navigation result source identity/case count mismatch; no pass inferred.'
}
if ($process.ExitCode -ne 0 -or $result.failures -ne 0 -or $result.blocked -ne 0 -or
    @($result.results | Where-Object { $_.status -ne 'PASS' }).Count -ne 0) {
    throw "UI navigation regressions failed or were blocked ($($process.ExitCode)); inspect navigation-results.json."
}
Write-Host "PASS: both actual Windows navigation regressions. Evidence: $resultPath"
