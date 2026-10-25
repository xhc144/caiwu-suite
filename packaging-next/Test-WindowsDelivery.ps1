[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$UpgradeInstaller,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ControllerExecutable,
    [switch]$RequireManagedDesktop
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or -not [Environment]::Is64BitProcess -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Run internal synthetic acceptance only in isolated x64 Windows CI.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Acceptance output must be a new directory.' }
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite'
if (Test-Path $registry) { throw 'This user already has a registered installation. Use a clean disposable runner.' }
New-Item -ItemType Directory -Path $output | Out-Null
$installRoot = Join-Path $env:LOCALAPPDATA ('Programs/Caiwu Internal QA 程序 ' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $output '合成 用户数据'
$evidence = Join-Path $output 'installed-runtime'
$controller = (Resolve-Path -LiteralPath $ControllerExecutable).Path
$results = [Collections.Generic.List[object]]::new()
$control = $null
$env:CAIWU_INTERNAL_QA_PASSWORD = 'Synthetic!' + [Guid]::NewGuid().ToString('N')
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Pass([string]$Name, $Evidence = $null) { $results.Add([ordered]@{ name = $Name; status = 'passed'; evidence = $Evidence }) }
function Run-Native([string]$Executable, [string]$Arguments, [int]$ExpectedCode = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WorkingDirectory $output
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); throw "Self-authored native process exceeded 120 seconds: $Executable" }
    $process.Refresh()
    if ($process.ExitCode -ne $ExpectedCode) { throw "Unexpected exit $($process.ExitCode), expected $ExpectedCode : $Executable" }
}
function Start-Controller([string]$Destination, [string]$Mode) {
    New-Item -ItemType Directory -Path $Destination | Out-Null
    $start = [Diagnostics.ProcessStartInfo]::new($controller)
    $start.UseShellExecute = $false; $start.WorkingDirectory = $Destination
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in @($installRoot, $dataRoot, $Destination, $Mode)) { $start.ArgumentList.Add($argument) }
    return [Diagnostics.Process]::Start($start)
}
function Wait-Controller($Process, [string]$Destination) {
    if (-not $Process.WaitForExit(300000)) { $Process.Kill($true); throw 'Independent installed-App controller exceeded five minutes.' }
    $Process.StandardOutput.ReadToEnd() | Set-Content (Join-Path $Destination 'controller-stdout.log')
    $Process.StandardError.ReadToEnd() | Set-Content (Join-Path $Destination 'controller-stderr.log')
    Assert ($Process.ExitCode -eq 0) 'Normal installed App controller failed; inspect partial runtime report and native PNG.'
    $report = Get-Content (Join-Path $Destination 'installed-runtime.json') -Raw | ConvertFrom-Json
    Assert ([bool]$report.success -and [bool]$report.windowsExecuted) 'Installed runtime evidence is incomplete.'
}
function Same-Book($Expected, $Actual) {
    Assert ($Actual.bookId -eq $Expected.bookId) 'Book identity changed.'
    Assert ($Actual.revision -eq $Expected.revision) 'Book revision changed.'
    Assert ($Actual.snapshotSha256 -eq $Expected.snapshotSha256) 'Persisted book contents differ.'
    Assert ($Actual.voucherCount -eq 1 -and $Actual.postedVoucherCount -eq 1) 'The single synthetic posted voucher is incomplete.'
    Assert ([decimal]$Actual.bankBalance -eq [decimal]123.45) 'Independent expected synthetic bank balance is 123.45.'
}
function Data-Hashes {
    $hashes = @{}
    foreach ($file in Get-ChildItem -LiteralPath $dataRoot -Recurse -File -Force | Where-Object { $_.Name -notlike '*.lock' -and $_.Name -notlike '*-wal' -and $_.Name -notlike '*-shm' }) {
        $hashes[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return $hashes
}
function Assert-Retained($Hashes) {
    foreach ($entry in $Hashes.GetEnumerator()) { Assert ((Test-Path -LiteralPath $entry.Key) -and (Get-FileHash -LiteralPath $entry.Key -Algorithm SHA256).Hash -eq $entry.Value) ('Retained data changed: ' + [IO.Path]::GetRelativePath($dataRoot, $entry.Key)) }
}
try {
    Run-Native $Installer ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot)
    Assert (Test-Path $registry) 'Native install did not register current-user ARP.'
    $pointerPath = Join-Path $installRoot 'current.json'
    $pointer = Get-Content $pointerPath -Raw | ConvertFrom-Json
    Assert ($pointer.version -eq '0.1.0.1' -and $pointer.dataRoot -eq $dataRoot) 'Native installation pointer/data root mismatch.'
    $manifest = Get-Content (Join-Path $installRoot "versions/$($pointer.version)/payload-manifest.json") -Raw | ConvertFrom-Json
    Assert ([bool]$manifest.managedDataContract) 'This internal QA requires the actual managed App composition.'
    Assert (Test-Path (Join-Path $installRoot "versions/$($pointer.version)/INTERNAL-UNVALIDATED.txt")) 'Internal candidate classification missing.'
    Pass 'native current-user NSIS installation with Chinese and space-separated program/data roots' @{ installRoot = $installRoot; dataRoot = $dataRoot; commit = $manifest.commit }

    $control = Start-Controller $evidence 'hold'
    $readyPath = Join-Path $evidence 'ready.json'; $deadline = [DateTime]::UtcNow.AddSeconds(180)
    while (-not (Test-Path $readyPath) -and -not $control.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
    Assert (Test-Path $readyPath) 'Actual installed App did not finish the normal login/book/voucher/module/backup flows; inspect partial controller evidence.'
    $ready = Get-Content $readyPath -Raw | ConvertFrom-Json
    Assert ($ready.checkoutCommit -eq $manifest.commit) 'Runtime evidence belongs to a different payload source commit.'
    $running = Get-Process -Id $ready.desktopPid
    Assert ($running.Path -eq (Join-Path $installRoot 'versions/0.1.0.1/Caiwu.Desktop.exe')) 'Controller did not launch the installed App.'
    $pointerHash = (Get-FileHash $pointerPath).Hash
    $bookHash = (Get-FileHash -LiteralPath $ready.bookPath).Hash
    Run-Native $UpgradeInstaller ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot) 1
    Assert (-not $running.HasExited) 'Busy upgrade killed the actual installed App.'
    Assert ((Get-FileHash $pointerPath).Hash -eq $pointerHash -and (Get-FileHash -LiteralPath $ready.bookPath).Hash -eq $bookHash) 'Busy upgrade changed the pointer or source book.'
    Pass 'native in-use upgrade rejected while actual installed App has an open restored ledger'
    New-Item -ItemType File (Join-Path $evidence 'stop') | Out-Null
    Wait-Controller $control $evidence; $control = $null
    Pass 'normal installed login create save distinct-actor review post book modules complete backup and restore' @{ report = 'installed-runtime/installed-runtime.json' }

    $retained = Data-Hashes
    $retained.Remove((Join-Path $dataRoot '.delivery-data-owner.json'))
    Run-Native $UpgradeInstaller ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot)
    $next = Get-Content $pointerPath -Raw | ConvertFrom-Json
    Assert ($next.version -eq '0.1.0.2') 'Idle upgrade did not activate the new native installed version.'
    Assert-Retained $retained
    $upgradeReceipts = @(Get-ChildItem (Join-Path $dataRoot '.delivery-backups') -Recurse -Filter 'backup-receipt.json' | ForEach-Object { Get-Content $_.FullName -Raw | ConvertFrom-Json })
    Assert (@($upgradeReceipts | Where-Object { $_.status -eq 'validated' -and @($_.moduleBackups).Count -eq 2 -and -not $_.globalIdentitiesIncluded }).Count -eq 1) 'Upgrade did not validate complete backups for both registered physical instances.'
    Pass 'native idle upgrade activates only after full registered-book and native attachment backups'
    $healthEvidence = Join-Path $output 'upgraded-runtime'
    $control = Start-Controller $healthEvidence 'health'; Wait-Controller $control $healthEvidence; $control = $null
    Pass 'actual upgraded installed App logs in with retained identities and opens retained source ledger'

    $retained = Data-Hashes
    $unknown = Join-Path $installRoot 'synthetic-user-note.txt'; 'Retain unowned synthetic file.' | Set-Content $unknown
    Run-Native (Join-Path $installRoot 'Uninstall.exe') ('/S _?=' + $installRoot)
    Assert (-not (Test-Path $registry) -and -not (Test-Path $pointerPath)) 'Uninstall left active registration or pointer.'
    foreach ($version in @('0.1.0.1', '0.1.0.2')) { Assert (-not (Test-Path (Join-Path $installRoot "versions/$version/Caiwu.Desktop.exe"))) 'Uninstall left managed product binaries.' }
    Assert-Retained $retained
    Assert (Test-Path $unknown) 'Uninstall deleted the unowned program-directory file.'
    Pass 'native uninstall preserves every ledger attachment backup global identity and unknown user file' @{ retainedFiles = $retained.Count }
    [ordered]@{ success = $true; classification = 'INTERNAL-UNVALIDATED'; sourceCommit = $manifest.commit; windowsExecuted = $true; nativeInstallerExecuted = $true; completeManagedUpgradeValidated = $true; approvedForUserDelivery = $false; signed = $false; trustedProductionUpdateFeed = $false; results = $results } | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $output 'windows-acceptance.json') -Encoding utf8
} catch {
    [ordered]@{ success = $false; classification = 'INTERNAL-UNVALIDATED'; windowsExecuted = $true; failure = $_.Exception.Message; approvedForUserDelivery = $false; results = $results } | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $output 'windows-acceptance.json') -Encoding utf8
    throw
} finally {
    Remove-Item Env:CAIWU_INTERNAL_QA_PASSWORD -ErrorAction SilentlyContinue
    if ($null -ne $control -and -not $control.HasExited) { $control.Kill($true) }
}
