[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$ControllerExecutable,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Disposable Windows CI only.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path $output) { throw 'Use a fresh evidence directory.' }
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite'
if (Test-Path $registry) { throw 'Existing user installation: refusing to touch it.' }
New-Item -ItemType Directory $output | Out-Null
$installRoot = Join-Path $env:LOCALAPPDATA ('Programs/Installed BookFlows 合成 ' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $output '合成 数据'
$evidence = Join-Path $output 'runtime'
New-Item -ItemType Directory $evidence | Out-Null
$controller = (Resolve-Path $ControllerExecutable).Path
$env:CAIWU_INTERNAL_QA_PASSWORD = 'Synthetic!' + [Guid]::NewGuid().ToString('N')
$control = $null
$result = [ordered]@{ sourceCommit = $env:GITHUB_SHA; success = $false; nativeInstalled = $false; controllerExitCode = $null; failure = $null; independentInstalledReadback = @(); uninstallRetention = $false }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Native([string]$Path, [string]$Arguments) {
    $p = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -WorkingDirectory $output
    if (-not $p.WaitForExit(120000)) { $p.Kill($true); throw 'Native installation operation timed out.' }
    $p.Refresh(); Assert ($p.ExitCode -eq 0) ('Native exit code ' + $p.ExitCode)
}
try {
    Native (Resolve-Path $Installer).Path ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot)
    Assert (Test-Path $registry) 'Native NSIS installation registration absent.'
    $pointer = Get-Content (Join-Path $installRoot 'current.json') -Raw | ConvertFrom-Json
    Assert ($pointer.dataRoot -eq $dataRoot -and $pointer.version -eq '0.1.0.1') 'Installed data/version binding mismatch.'
    $versionRoot = Join-Path $installRoot 'versions/0.1.0.1'
    $manifest = Get-Content (Join-Path $versionRoot 'payload-manifest.json') -Raw | ConvertFrom-Json
    Assert ($manifest.commit -eq $env:GITHUB_SHA -and $manifest.managedDataContract) 'Actual installed payload source or managed capability mismatch.'
    $result.nativeInstalled = $true
    $start = [Diagnostics.ProcessStartInfo]::new($controller)
    $start.UseShellExecute = $false; $start.WorkingDirectory = $evidence
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($arg in @($installRoot, $dataRoot, $evidence)) { $start.ArgumentList.Add($arg) }
    $control = [Diagnostics.Process]::Start($start)
    $stdout = $control.StandardOutput.ReadToEndAsync(); $stderr = $control.StandardError.ReadToEndAsync()
    if (-not $control.WaitForExit(660000)) { $control.Kill($true); throw 'Installed business controller timed out.' }
    $stdout.GetAwaiter().GetResult() | Set-Content (Join-Path $evidence 'controller-stdout.log')
    $stderr.GetAwaiter().GetResult() | Set-Content (Join-Path $evidence 'controller-stderr.log')
    $result.controllerExitCode = $control.ExitCode
    # A second installed self-contained process reads each actual physical ledger after App exit.
    foreach ($ledger in Get-ChildItem $dataRoot -Filter '*.caiwu' -File -Recurse | Where-Object { $_.FullName -notmatch '\.delivery-backups' }) {
        $inspect = [Diagnostics.ProcessStartInfo]::new((Join-Path $versionRoot 'Caiwu.Delivery.exe'))
        $inspect.UseShellExecute = $false; $inspect.RedirectStandardOutput = $true; $inspect.RedirectStandardError = $true
        foreach ($arg in @('inspect-book', $installRoot, [IO.Path]::GetRelativePath($dataRoot, $ledger.FullName))) { $inspect.ArgumentList.Add($arg) }
        $p = [Diagnostics.Process]::Start($inspect)
        $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit(30000)) { $p.Kill($true); throw 'Independent installed reader timed out.' }
        Assert ($p.ExitCode -eq 0) ('Independent installed reader failed: ' + $e.GetAwaiter().GetResult())
        $result.independentInstalledReadback += [ordered]@{ relativePath = [IO.Path]::GetRelativePath($dataRoot, $ledger.FullName); sha256 = (Get-FileHash $ledger.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); inspection = ($o.GetAwaiter().GetResult() | ConvertFrom-Json) }
    }
    Assert ($result.independentInstalledReadback.Count -ge 3) 'Expected source, copied-as-new and restored physical ledgers.'
    $readback = Get-Content (Join-Path $evidence 'readback.json') -Raw | ConvertFrom-Json
    $sourceId = $readback.source.book.id
    $sameIdentity = @($result.independentInstalledReadback | Where-Object { $_.inspection.bookId -eq $sourceId })
    $newIdentity = @($result.independentInstalledReadback | Where-Object { $_.inspection.bookId -ne $sourceId })
    Assert ($sameIdentity.Count -eq 2 -and $newIdentity.Count -eq 1) 'Independent installed reader identity distinction failed.'
    Assert ($sameIdentity[0].inspection.snapshotSha256 -eq $sameIdentity[1].inspection.snapshotSha256) 'Source/restored ledger semantics differ.'
    foreach ($item in $result.independentInstalledReadback) { Assert ($item.inspection.voucherCount -eq 2 -and $item.inspection.postedVoucherCount -eq 1 -and [decimal]$item.inspection.bankBalance -eq [decimal]123.45) 'Independent exact voucher/status/balance mismatch.' }
    $hashes = @{}
    foreach ($file in Get-ChildItem $dataRoot -File -Recurse | Where-Object { $_.Name -notlike '*.lock' -and $_.Name -notlike '*-wal' -and $_.Name -notlike '*-shm' }) { $hashes[$file.FullName] = (Get-FileHash $file.FullName -Algorithm SHA256).Hash }
    Native (Join-Path $installRoot 'Uninstall.exe') ('/S _?=' + $installRoot)
    foreach ($entry in $hashes.GetEnumerator()) { Assert ((Test-Path $entry.Key) -and (Get-FileHash $entry.Key -Algorithm SHA256).Hash -eq $entry.Value) ('Uninstall changed retained synthetic file: ' + [IO.Path]::GetRelativePath($dataRoot, $entry.Key)) }
    $result.uninstallRetention = $true
    Assert ($control.ExitCode -eq 0) 'Installed suite contains failed business cases; see runtime/installed-bookflows.json.'
    $report = Get-Content (Join-Path $evidence 'installed-bookflows.json') -Raw | ConvertFrom-Json
    Assert ($report.success -and $report.normalProductLogin) 'Installed suite incomplete.'
    Assert (@($report.cases | Where-Object status -ne 'passed').Count -eq 0) 'A requested installed business case is failed or not run.'
    $result.success = $true
} catch { $result.failure = $_.Exception.ToString(); throw }
finally {
    if ($control -and -not $control.HasExited) { $control.Kill($true) }
    $result | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $output 'installation-and-independent-readback.json') -Encoding utf8
    # Explicit allowlist uploads only report/PNG/log evidence; no installer, payload, identities, or ledger data.
    $files = @(Get-ChildItem $output -File -Recurse | Where-Object { $_.FullName -notlike "$dataRoot*" -and $_.Extension -in @('.json', '.png', '.log') } | Sort-Object FullName | ForEach-Object { [ordered]@{ path = [IO.Path]::GetRelativePath($output, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
    [ordered]@{ sourceCommit = $env:GITHUB_SHA; files = $files } | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'evidence-manifest.json') -Encoding utf8
    Remove-Item Env:CAIWU_INTERNAL_QA_PASSWORD
}
