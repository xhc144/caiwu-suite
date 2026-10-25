[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$harness = Join-Path $ProjectRoot 'packaging-next/Test-WindowsDelivery.ps1'
$harnessAst = $null
foreach ($file in Get-ChildItem (Join-Path $ProjectRoot 'packaging-next') -Filter '*.ps1') {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | ForEach-Object { $_.ToString() } | Out-String) }
    if ($file.FullName -eq $harness) { $harnessAst = $ast }
}
if ($null -eq $harnessAst) { throw 'Runtime acceptance harness was not parsed.' }
# Exercise the actual acceptance assertions with independently selected passing/failing values.
foreach ($name in @('Assert', 'Same-Book')) {
    $function = $harnessAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($null -eq $function) { throw "Acceptance function is absent: $name" }
    . ([ScriptBlock]::Create($function.Extent.Text))
}
$sample = [pscustomobject]@{
    bookId = '0d68f5b6-4f75-4e61-95dd-637cf5859888'; revision = 10
    voucherCount = 1; postedVoucherCount = 1; bankBalance = [decimal]123.45
    snapshotSha256 = ('a' * 64)
}
Same-Book $sample $sample
$checked = 1
foreach ($case in @(
    @{ property = 'bookId'; value = 'c8834c36-e03a-4875-9410-5fa372fa18f2' },
    @{ property = 'revision'; value = 11 },
    @{ property = 'voucherCount'; value = 2 },
    @{ property = 'postedVoucherCount'; value = 2 },
    @{ property = 'bankBalance'; value = [decimal]108799.99 },
    @{ property = 'snapshotSha256'; value = ('b' * 64) }
)) {
    $changed = $sample.PSObject.Copy()
    $changed.($case.property) = $case.value
    $rejected = $false
    try { Same-Book $sample $changed } catch { $rejected = $true }
    Assert $rejected ("Runtime acceptance would miss a changed " + $case.property)
    $checked++
}
$commands = $harnessAst.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)
foreach ($command in $commands) {
    if ($command.GetCommandName() -in @('dotnet', 'Invoke-Expression', 'Import-Certificate', 'New-SelfSignedCertificate')) {
        throw 'Runtime acceptance must not switch to source projects, arbitrary execution or substitute signing trust.'
    }
}
if ($IsWindows -and $env:GITHUB_ACTIONS -eq 'true' -and (Test-Path (Join-Path $ProjectRoot 'docs/acceptance/DELIVERY_PAUSED.md'))) {
    $blockedOutput = Join-Path ([IO.Path]::GetTempPath()) ('caiwu-production-hold-' + [Guid]::NewGuid().ToString('N'))
    $blocked = $false
    try {
        & $harness -Installer 'must-not-run.exe' -UpgradeInstaller 'must-not-run.exe' -ControllerExecutable 'must-not-run.exe' -OutputDirectory $blockedOutput -ProductionCandidate -ExpectedCommit ('a' * 40)
    } catch {
        $blocked = $_.Exception.Message -like '*Independent delivery hold blocks production*'
    }
    Assert $blocked 'Production acceptance did not reject the actual active delivery hold.'
    Assert (-not (Test-Path $blockedOutput)) 'Production acceptance created output before checking the hold.'
    $checked++
}
[ordered]@{ success = $true; parser = $PSVersionTable.PSVersion.ToString(); assertionCases = $checked; windowsRuntimeExecuted = $false } | ConvertTo-Json
