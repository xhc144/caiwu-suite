[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$UpgradeInstaller,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) { throw 'Run this acceptance harness in x64 PowerShell 7 on a disposable Windows runner.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Acceptance output must be a new directory.' }
New-Item -ItemType Directory -Path $output | Out-Null
$installRoot = Join-Path $output 'program'
$dataRoot = Join-Path $output 'data'
$evidence = Join-Path $output 'wpf'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite'
if (Test-Path $registry) { throw 'An installation is already registered for this user. Use a disposable clean Windows runner.' }
$results = [Collections.Generic.List[object]]::new()
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Run-OwnProcess([string]$Executable, [string]$Arguments, [int]$ExpectedCode = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(120000)) { $process.Kill($true); throw "Self-authored process timed out: $Executable" }
    if ($process.ExitCode -ne $ExpectedCode) { throw "Unexpected exit $($process.ExitCode), expected $ExpectedCode : $Executable" }
}
function Pass([string]$Name) { $results.Add([ordered]@{ name = $Name; status = 'passed' }) }
try {
    # /D is last and deliberately unquoted as required by the native NSIS command-line parser.
    Run-OwnProcess $Installer ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot)
    Assert (Test-Path $registry) 'Installed program is not registered in current-user ARP.'
    $pointerPath = Join-Path $installRoot 'current.json'
    $pointer = Get-Content -LiteralPath $pointerPath -Raw | ConvertFrom-Json
    Assert ($pointer.dataRoot -eq $dataRoot) 'Installer ignored the isolated data root.'
    $helper = Join-Path $installRoot "versions/$($pointer.version)/Caiwu.Delivery.exe"
    Assert (Test-Path -LiteralPath $helper) 'Installed self-contained delivery launcher is missing.'
    Pass 'silent current-user install and ARP registration'

    Run-OwnProcess $helper ('launch "' + $installRoot + '" --smoke-test "' + $evidence + '"')
    $smoke = Get-Content -LiteralPath (Join-Path $evidence 'ui-verification.json') -Raw | ConvertFrom-Json
    Assert ($smoke.success -eq $true) 'Installed WPF verification did not report success.'
    Assert (@(Get-ChildItem -LiteralPath $evidence -Filter '*.png').Count -ge 4) 'Installed WPF screenshots are incomplete.'
    Pass 'installed self-authored WPF and real synthetic SQLite smoke'

    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
    $sentinel = Join-Path $dataRoot 'synthetic-do-not-delete.caiwu'
    [IO.File]::WriteAllText($sentinel, 'Synthetic acceptance sentinel; no real accounting data.')
    $sentinelHash = (Get-FileHash -LiteralPath $sentinel).Hash
    $pointerHash = (Get-FileHash -LiteralPath $pointerPath).Hash
    $unknown = Join-Path $installRoot 'user-created-note.txt'
    [IO.File]::WriteAllText($unknown, 'Synthetic user-owned file must survive uninstall.')
    $lock = [IO.File]::Open((Join-Path $installRoot '.delivery.lock'), 'Open', 'ReadWrite', 'None')
    try { Run-OwnProcess $helper ('uninstall "' + $installRoot + '"') 1 }
    finally { $lock.Dispose() }
    Assert ((Get-FileHash -LiteralPath $pointerPath).Hash -eq $pointerHash) 'Active lease did not protect the installed version.'
    Pass 'active launch lease prevents uninstall without killing application processes'

    # The current Desktop does not register every opened book. This must fail closed.
    Run-OwnProcess $UpgradeInstaller ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot) 1
    Assert ((Get-FileHash -LiteralPath $pointerPath).Hash -eq $pointerHash) 'Blocked upgrade changed active application.'
    Assert ((Get-FileHash -LiteralPath $sentinel).Hash -eq $sentinelHash) 'Blocked upgrade changed a ledger sentinel.'
    Pass 'unintegrated Desktop upgrade is blocked and preserves pointer and ledger data'

    $rejected = $false
    try {
        & (Join-Path $PSScriptRoot 'Assert-TrustedInstaller.ps1') -Installer $UpgradeInstaller -ExpectedSha256 (Get-FileHash -LiteralPath $UpgradeInstaller -Algorithm SHA256).Hash -ExpectedVersion '0.1.0.2' -CurrentVersion '0.1.0.1' -PublisherThumbprints @('1111111111111111111111111111111111111111') | Out-Null
    } catch {
        if ($_.Exception.Message -like '*valid Windows-trusted Authenticode signature*') { $rejected = $true }
        else { throw }
    }
    Assert $rejected 'Unsigned installer was not explicitly rejected by the trusted-update signature gate.'
    Pass 'unsigned installer cannot pass trusted-update approval'

    $uninstaller = Join-Path $installRoot 'Uninstall.exe'
    # _?= keeps NSIS in this process so the bounded wait observes actual uninstallation.
    Run-OwnProcess $uninstaller ('/S _?=' + $installRoot)
    Assert (-not (Test-Path $registry)) 'Uninstall left ARP registration behind.'
    Assert (-not (Test-Path -LiteralPath $pointerPath)) 'Uninstall did not deactivate the application.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $installRoot "versions/$($pointer.version)/Caiwu.Desktop.exe"))) 'Uninstall left the managed Desktop executable installed.'
    Assert ((Get-FileHash -LiteralPath $sentinel).Hash -eq $sentinelHash) 'Uninstall changed external ledger data.'
    Assert (Test-Path -LiteralPath $unknown) 'Uninstall removed an unowned file.'
    Assert (Test-Path -LiteralPath (Join-Path $evidence 'ui-verification.json')) 'Uninstall deleted external verification evidence.'
    Pass 'native uninstall removes managed program and ARP while preserving ledgers and unowned files'
    [ordered]@{ success = $true; windowsExecuted = $true; manualKeyboardDpiPrinterValidated = $false; results = $results } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'windows-acceptance.json') -Encoding utf8
} catch {
    [ordered]@{ success = $false; windowsExecuted = $true; failure = $_.Exception.Message; results = $results } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'windows-acceptance.json') -Encoding utf8
    throw
}
