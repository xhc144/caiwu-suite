[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DeliveryTool,
    [Parameter(Mandatory)][string]$Policy,
    [Parameter(Mandatory)][string]$CurrentVersion,
    [Parameter(Mandatory)][string]$StagingDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Authenticode verification requires Windows.' }
# Policy comes from trusted installed configuration, never from a downloaded feed.
$resultText = & $DeliveryTool stage-update $Policy $CurrentVersion $StagingDirectory
if ($LASTEXITCODE -ne 0) { throw 'Update staging failed.' }
$result = ($resultText -join "`n") | ConvertFrom-Json
if ($result.status -in @('disabled', 'current')) { return $result }
$config = Get-Content -LiteralPath $Policy -Raw | ConvertFrom-Json
$staged = [IO.Path]::GetFullPath($result.path)
try {
    & (Join-Path $PSScriptRoot 'Assert-TrustedInstaller.ps1') -Installer $staged -ExpectedSha256 $result.candidate.sha256 -ExpectedVersion $result.candidate.version -CurrentVersion $CurrentVersion -PublisherThumbprints $config.publisherThumbprints | Out-Null
    $approved = [IO.Path]::ChangeExtension($staged, 'exe')
    [IO.File]::Move($staged, $approved, $false)
    [ordered]@{ status = 'verified-awaiting-user-approval'; installer = $approved; version = $result.candidate.version } | ConvertTo-Json
    # No Start-Process, Invoke-Expression, bypass flag, certificate import, or security setting change.
} catch {
    if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged }
    throw
}
