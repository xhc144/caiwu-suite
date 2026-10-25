[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$UpgradeInstaller,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [switch]$RequireManagedDesktop
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Run in x64 PowerShell 7 on a disposable Windows runner.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Acceptance output must be a new directory.' }
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite'
if (Test-Path $registry) { throw 'This user already has a registered installation. Use a clean disposable runner.' }
New-Item -ItemType Directory -Path $output | Out-Null
$installRoot = Join-Path $output 'program'
$dataRoot = Join-Path $output 'data'
$evidence = Join-Path $dataRoot 'verification'
$results = [Collections.Generic.List[object]]::new()
$launcher = $null
$desktop = $null
$managedDesktopObserved = $false
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Pass([string]$Name, $Evidence = $null) { $results.Add([ordered]@{ name = $Name; status = 'passed'; evidence = $Evidence }) }
function Run-Native([string]$Executable, [string]$Arguments, [int]$ExpectedCode = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); throw "Self-authored process timed out: $Executable" }
    $process.Refresh()
    if ($process.ExitCode -ne $ExpectedCode) { throw "Unexpected exit $($process.ExitCode), expected $ExpectedCode : $Executable" }
}
function Run-Installed([string[]]$CommandArguments, [switch]$Json) {
    $start = [Diagnostics.ProcessStartInfo]::new($helper)
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $CommandArguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); throw 'Installed delivery command timed out.' }
    $text = $stdout.GetAwaiter().GetResult()
    $errorText = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Installed delivery command failed: $errorText" }
    if ($Json) { return $text | ConvertFrom-Json }
}
function Same-Book($Expected, $Actual) {
    Assert ($Actual.bookId -eq $Expected.bookId) 'Book identity changed.'
    Assert ($Actual.revision -eq $Expected.revision) 'Book revision changed.'
    Assert ($Actual.snapshotSha256 -eq $Expected.snapshotSha256) 'Persisted book contents differ.'
    Assert ($Actual.voucherCount -eq 3 -and $Actual.postedVoucherCount -eq 3) 'Synthetic posted vouchers are incomplete.'
    Assert ([decimal]$Actual.bankBalance -eq [decimal]108800) 'Independent expected synthetic bank balance is 108800.'
}
try {
    # NSIS /D is last and deliberately unquoted, per its native command-line parser.
    Run-Native $Installer ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot)
    Assert (Test-Path $registry) 'Installed program is not registered in current-user ARP.'
    $pointerPath = Join-Path $installRoot 'current.json'
    $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
    Assert ($pointer.dataRoot -eq $dataRoot) 'Installer ignored the isolated data root.'
    $versionRoot = Join-Path $installRoot "versions/$($pointer.version)"
    $helper = Join-Path $versionRoot 'Caiwu.Delivery.exe'
    $desktopPath = Join-Path $versionRoot 'Caiwu.Desktop.exe'
    $manifest = Get-Content -LiteralPath (Join-Path $versionRoot 'payload-manifest.json') -Raw | ConvertFrom-Json
    foreach ($binary in @($helper, $desktopPath)) {
        Assert (Test-Path -LiteralPath $binary) "Installed executable is absent: $binary"
        $entry = @($manifest.files | Where-Object { $_.path -eq [IO.Path]::GetFileName($binary) })
        Assert ($entry.Count -eq 1) 'Installed executable is missing from the payload manifest.'
        Assert ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash -eq $entry[0].sha256) 'Installed executable differs from the payload manifest.'
    }
    Run-Installed @('verify', $versionRoot)
    Pass 'native install, ARP and actual installed executable hashes' @{ launcher = $helper; desktop = $desktopPath }

    # All runtime probes below invoke installed EXEs. This script never runs dotnet, source projects, or reference software.
    Run-Installed @('launch', $installRoot, '--smoke-test', $evidence)
    $smoke = Get-Content -LiteralPath (Join-Path $evidence 'ui-verification.json') -Raw | ConvertFrom-Json
    Assert ($smoke.success -eq $true) 'Installed WPF verification failed.'
    Assert (@(Get-ChildItem -LiteralPath $evidence -Filter '*.png').Count -ge 4) 'Installed WPF screenshots are incomplete.'
    $books = @(Get-ChildItem -LiteralPath $evidence -Filter '*.caiwu')
    Assert ($books.Count -eq 1) 'Installed WPF must create exactly one isolated synthetic book.'
    $book = $books[0].FullName
    $relativeBook = [IO.Path]::GetRelativePath($dataRoot, $book)
    $before = Run-Installed @('inspect-book', $installRoot, $relativeBook) -Json
    Same-Book $before $before
    $before | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'book-before.json') -Encoding utf8
    Pass 'installed WPF creates real synthetic SQLite and independent known balances' @{ book = $book; snapshotSha256 = $before.snapshotSha256 }

    $inventoryPath = Join-Path $dataRoot 'managed-books.json'
    if (Test-Path -LiteralPath $inventoryPath) {
        $inventory = Get-Content -LiteralPath $inventoryPath -Raw | ConvertFrom-Json
        $managedDesktopObserved = ($inventory.contractVersion -eq 1 -and $book -in @($inventory.databasePaths))
    }
    if ($RequireManagedDesktop) {
        Assert ([bool]$manifest.managedDataContract -and $managedDesktopObserved) 'Desktop must register its actual synthetic book and advertise the audited managed-data contract; this script does not manufacture that state.'
    }

    # Keep a real installed WPF process running while invoking the native upgrade installer.
    $start = [Diagnostics.ProcessStartInfo]::new($helper)
    $start.UseShellExecute = $false
    $start.ArgumentList.Add('launch'); $start.ArgumentList.Add($installRoot)
    $launcher = [Diagnostics.Process]::Start($start)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        if ($launcher.HasExited) { throw 'Installed launcher exited before the WPF window appeared.' }
        $windows = @(Get-Process -Name 'Caiwu.Desktop' -ErrorAction SilentlyContinue | Where-Object {
            $_.Path -eq $desktopPath -and $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -eq '财务套件 · 开发预览'
        })
        if ($windows.Count -eq 1) { $desktop = $windows[0]; break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    Assert ($null -ne $desktop) 'No real installed WPF window appeared.'
    $leaseHeld = $false
    try { $probe = [IO.File]::Open((Join-Path $installRoot '.delivery.lock'), 'Open', 'ReadWrite', 'None'); $probe.Dispose() }
    catch [IO.IOException] { $leaseHeld = $true }
    Assert $leaseHeld 'The real installed launcher did not hold its application lease.'
    $pointerHash = (Get-FileHash -LiteralPath $pointerPath).Hash
    $sourceHash = (Get-FileHash -LiteralPath $book).Hash
    Run-Native $UpgradeInstaller ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot) 1
    Assert (-not $desktop.HasExited) 'Upgrade terminated the running application.'
    Assert ((Get-FileHash -LiteralPath $pointerPath).Hash -eq $pointerHash) 'In-use upgrade changed the active pointer.'
    Assert ((Get-FileHash -LiteralPath $book).Hash -eq $sourceHash) 'In-use upgrade changed the synthetic book.'
    Pass 'native upgrade is rejected while actual installed WPF is running' @{ processId = $desktop.Id; executable = $desktop.Path; windowTitle = $desktop.MainWindowTitle; bookOpenDuringThisNormalWindow = $false }
    Assert ($desktop.CloseMainWindow()) 'The synthetic normal window did not accept a close request.'
    if (-not $launcher.WaitForExit(30000)) { throw 'Installed launcher did not release its lease after WPF closed.' }
    Assert ($launcher.ExitCode -eq 0) 'Installed normal WPF exited unsuccessfully.'
    $launcher = $null; $desktop = $null

    $backupRelative = '.delivery-backups/windows-acceptance.caiwu'
    $restoreRelative = 'recovered/restored-copy.caiwu'
    $backup = Run-Installed @('backup-book', $installRoot, $relativeBook, $backupRelative) -Json
    Same-Book $before $backup.source; Same-Book $before $backup.copy
    $restored = Run-Installed @('restore-book', $installRoot, $backupRelative, $restoreRelative) -Json
    Same-Book $before $restored.source; Same-Book $before $restored.copy
    $after = Run-Installed @('inspect-book', $installRoot, $relativeBook) -Json
    Same-Book $before $after
    Assert ((Get-FileHash -LiteralPath $book).Hash -eq $sourceHash) 'Backup/restore changed the source book bytes.'
    $backupPath = Join-Path $dataRoot $backupRelative
    $restoredPath = Join-Path $dataRoot $restoreRelative
    $backupHash = (Get-FileHash -LiteralPath $backupPath).Hash
    $restoredHash = (Get-FileHash -LiteralPath $restoredPath).Hash
    @{ backup = $backup; restored = $restored } | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $output 'backup-restore.json') -Encoding utf8
    Pass 'installed self-contained delivery tool backs up and restores the actual WPF-created book' @{ backup = $backupPath; restored = $restoredPath; snapshotSha256 = $before.snapshotSha256 }

    # This is an explicitly scoped single-book backup test, not certification of a complete Desktop inventory.
    if (-not [bool]$manifest.managedDataContract) {
        Run-Native $UpgradeInstaller ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot) 1
        Assert ((Get-FileHash -LiteralPath $pointerPath).Hash -eq $pointerHash) 'Unintegrated idle upgrade changed the active application.'
        Pass 'idle upgrade stays blocked until the complete Desktop managed-data contract is integrated'
    }
    $policy = Run-Installed @('check-update', (Join-Path $versionRoot 'update-policy.json'), $pointer.version) -Json
    Assert ($policy.status -eq 'disabled') 'Unsigned preview unexpectedly enabled automatic update checks.'
    $rejected = $false
    try {
        & (Join-Path $PSScriptRoot 'Assert-TrustedInstaller.ps1') -Installer $UpgradeInstaller -ExpectedSha256 (Get-FileHash -LiteralPath $UpgradeInstaller -Algorithm SHA256).Hash -ExpectedVersion '0.1.0.2' -CurrentVersion '0.1.0.1' -PublisherThumbprints @('1111111111111111111111111111111111111111') | Out-Null
    } catch {
        if ($_.Exception.Message -like '*valid Windows-trusted Authenticode signature*') { $rejected = $true } else { throw }
    }
    Assert $rejected 'Unsigned installer was not explicitly rejected by the Windows signature gate.'
    Pass 'installed update policy is disabled and Windows rejects the unsigned candidate'

    $unknown = Join-Path $installRoot 'user-created-note.txt'
    [IO.File]::WriteAllText($unknown, 'Synthetic user-owned file must survive uninstall.')
    $uninstaller = Join-Path $installRoot 'Uninstall.exe'
    Run-Native $uninstaller ('/S _?=' + $installRoot)
    Assert (-not (Test-Path $registry)) 'Uninstall left ARP registration.'
    Assert (-not (Test-Path -LiteralPath $pointerPath)) 'Uninstall did not deactivate the application.'
    Assert (-not (Test-Path -LiteralPath $desktopPath)) 'Uninstall left the managed Desktop executable.'
    Assert (-not (Test-Path -LiteralPath $helper)) 'Uninstall left the installed helper executable.'
    Assert ((Get-FileHash -LiteralPath $book).Hash -eq $sourceHash) 'Uninstall changed the synthetic source book.'
    Assert ((Get-FileHash -LiteralPath $backupPath).Hash -eq $backupHash) 'Uninstall changed the consistent backup.'
    Assert ((Get-FileHash -LiteralPath $restoredPath).Hash -eq $restoredHash) 'Uninstall changed the recovered copy.'
    Assert (Test-Path -LiteralPath $unknown) 'Uninstall removed an unowned program-directory file.'
    Assert (Test-Path -LiteralPath (Join-Path $evidence 'ui-verification.json')) 'Uninstall deleted external WPF evidence.'
    Pass 'native uninstall removes installed executables and ARP while preserving source backup recovery and unknown files'
    [ordered]@{
        success = $true; windowsExecuted = $true; sourceProjectsExecutedByThisHarness = $false
        managedDesktopInventoryObserved = $managedDesktopObserved; managedDataContractAdvertised = [bool]$manifest.managedDataContract
        completeManagedUpgradeValidated = $false; manualKeyboardDpiPrinterValidated = $false
        dependencies = @('Desktop must consume CAIWU_DATA_ROOT and register every actual created/opened/restored book.', 'The launcher currently owns both leases; Desktop must not blindly reacquire the same non-shareable locks.', 'An audited complete Desktop contract plus build manifest enablement is required before positive upgrade activation tests.')
        results = $results
    } | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $output 'windows-acceptance.json') -Encoding utf8
} catch {
    [ordered]@{ success = $false; windowsExecuted = $true; failure = $_.Exception.Message; results = $results } |
        ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $output 'windows-acceptance.json') -Encoding utf8
    throw
} finally {
    if ($null -ne $desktop -and -not $desktop.HasExited) { [void]$desktop.CloseMainWindow() }
    if ($null -ne $launcher -and -not $launcher.HasExited -and -not $launcher.WaitForExit(5000)) { $launcher.Kill($true) }
}
