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
$expected = @('OPENING', 'ACCOUNT', 'DELETE', 'REVIEW', 'POST', 'SAME-IDENTITY-RESTORE')
$results = @()
foreach ($id in $expected) {
    $caseDirectory = Join-Path $OutputDirectory $id
    New-Item -ItemType Directory -Force $caseDirectory | Out-Null
    $resultPath = Join-Path $caseDirectory 'mutation-windows-results.json'
    if (Test-Path $resultPath) { Remove-Item $resultPath }
    $process = Start-Process (Get-Command dotnet).Source -ArgumentList @(('"' + $dll + '"'), ('"' + $caseDirectory + '"'), $id) -PassThru -RedirectStandardOutput (Join-Path $caseDirectory 'stdout.log') -RedirectStandardError (Join-Path $caseDirectory 'stderr.log')
    if (-not $process.WaitForExit(35000)) {
        $process.Kill($true)
        $results += [ordered]@{ id = $id; status = 'BLOCKED'; detail = 'Actual mutation scenario exceeded its 35-second process watchdog. Other scenarios continue independently.' }
    } elseif (-not (Test-Path $resultPath)) {
        $results += [ordered]@{ id = $id; status = 'FAIL'; detail = "Process exited $($process.ExitCode) without source-bound evidence." }
    } else {
        $caseResult = Get-Content -Raw $resultPath | ConvertFrom-Json
        if ($caseResult.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or -not $caseResult.actualWindowsWpf -or $caseResult.results.Count -ne 1 -or $caseResult.results[0].id -ne $id -or ($process.ExitCode -ne 0 -and $caseResult.results[0].status -eq 'PASS')) {
            $results += [ordered]@{ id = $id; status = 'FAIL'; detail = 'Per-scenario result identity/count/exit mismatch.' }
        } else { $results += $caseResult.results[0] }
    }
}
$result = [ordered]@{
    checkoutCommit = $env:CAIWU_REVALIDATION_COMMIT; actualWindowsWpf = $true
    mechanism = 'Six isolated real production WPF processes, actual SQLite competing writers and same-process native confirmations; individual watchdogs preserve partial failures.'
    physicalKeyboardImeTested = $false; failures = @($results | Where-Object { $_.status -ne 'PASS' }).Count; results = $results
}
$result | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $OutputDirectory 'mutation-windows-results.json') -Encoding utf8
if ($result.checkoutCommit -ne $env:CAIWU_REVALIDATION_COMMIT -or -not $result.actualWindowsWpf -or $result.failures -ne 0 -or $result.results.Count -ne 6 -or @(Compare-Object $expected @($result.results | ForEach-Object { $_.id })).Count -ne 0 -or @($result.results | Where-Object { $_.status -ne 'PASS' }).Count -ne 0) { throw 'Mutation UI source/case/status mismatch.' }
