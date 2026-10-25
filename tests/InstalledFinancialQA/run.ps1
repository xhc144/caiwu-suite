[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$OutputDirectory, [string]$Version = '0.1.0.1')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not [Environment]::Is64BitProcess) { throw 'Disposable x64 Windows CI only.' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Evidence root must be new.' }
if (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CaiwuSuite') { throw 'Requires a clean runner with no existing installation.' }
New-Item -ItemType Directory -Path $output | Out-Null
$installRoot = Join-Path $env:LOCALAPPDATA ('Programs/Caiwu Financial QA 合成 ' + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $output '合成 用户数据'
$evidence = Join-Path $output 'evidence'; New-Item -ItemType Directory -Path $evidence | Out-Null
$controller = (Resolve-Path "$PSScriptRoot/bin/Release/net10.0-windows/Caiwu.InstalledFinancialQA.exe").Path
$installed = $false
try {
    $native = Start-Process -FilePath $Installer -ArgumentList ('/S /DATAROOT="' + $dataRoot + '" /D=' + $installRoot) -WorkingDirectory $output -PassThru
    if (-not $native.WaitForExit(120000)) { $native.Kill($true); throw 'Native installer timeout.' }
    $native.Refresh(); if ($native.ExitCode -ne 0) { throw "Native installer failed: $($native.ExitCode)" }; $installed = $true
    $pointer = Get-Content (Join-Path $installRoot 'current.json') -Raw | ConvertFrom-Json
    if ($pointer.dataRoot -ne $dataRoot -or $pointer.version -ne $Version) { throw 'Installed pointer mismatch.' }
    $start = [Diagnostics.ProcessStartInfo]::new($controller); $start.UseShellExecute = $false; $start.WorkingDirectory = $evidence
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    foreach ($argument in @($installRoot, $dataRoot, $evidence)) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(450000)) { $process.Kill($true); throw 'Installed financial controller exceeded 450 seconds.' }
    $stdout.GetAwaiter().GetResult() | Set-Content (Join-Path $evidence 'controller-stdout.log')
    $stderr.GetAwaiter().GetResult() | Set-Content (Join-Path $evidence 'controller-stderr.log')
    if ($process.ExitCode -ne 0) { throw 'Installed financial business acceptance failed; inspect partial JSON and native screenshot.' }
    $report = Get-Content (Join-Path $evidence 'financial-results.json') -Raw | ConvertFrom-Json
    if (-not $report.success -or -not $report.normalProductLogin -or $report.sourceCommit -ne $env:GITHUB_SHA -or @($report.cases.PSObject.Properties | Where-Object Value -ne 'passed').Count -ne 0) { throw 'Business evidence incomplete or wrong source.' }
} finally {
    if ($installed -and (Test-Path (Join-Path $installRoot 'Uninstall.exe'))) {
        $native = Start-Process -FilePath (Join-Path $installRoot 'Uninstall.exe') -ArgumentList ('/S _?=' + $installRoot) -WorkingDirectory $output -PassThru
        if (-not $native.WaitForExit(120000)) { $native.Kill($true); throw 'Synthetic native cleanup timed out.' }
        $native.Refresh(); if ($native.ExitCode -ne 0) { throw 'Synthetic native cleanup failed.' }
    }
}
