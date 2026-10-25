[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedCommit,
    [Parameter(Mandatory)][string]$MakeNsis,
    [Parameter(Mandatory)][string]$ControllerExecutable,
    [ValidateSet('0.1.0.1', '0.1.0.2')][string]$Version = '0.1.0.1'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') { throw 'Internal QA candidate generation is restricted to the isolated Windows CI.' }
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path docs/acceptance/DELIVERY_PAUSED.md)) { throw 'Internal QA must preserve the delivery hold.' }
    if ((git rev-parse HEAD).Trim() -ne $ExpectedCommit -or @(git status --porcelain --untracked-files=normal).Count -ne 0) { throw 'Internal QA requires the exact frozen clean source commit.' }
    $output = [IO.Path]::GetFullPath($OutputDirectory)
    if ((Split-Path -Leaf (Split-Path -Parent $output)) -ne 'internal-qa') { throw 'Use an explicit internal-qa/<version> output directory.' }
    $compiler = (Resolve-Path -LiteralPath $MakeNsis).Path
    $controller = (Resolve-Path -LiteralPath $ControllerExecutable).Path
    if ((& $compiler -VERSION).Trim() -ne 'v3.13') { throw 'Pinned NSIS 3.13 required.' }
    & "$PSScriptRoot/Prepare-WindowsCandidate.ps1" -OutputDirectory $output -Version $Version
    $payload = Join-Path $output 'payload'
    $notices = Join-Path $payload 'delivery-notices'; New-Item -ItemType Directory $notices | Out-Null
    Copy-Item "$PSScriptRoot/THIRD-PARTY-NOTICES.md", "$PSScriptRoot/NSIS-COPYING.txt", "$PSScriptRoot/licenses/Apache-2.0.txt" $notices
    $packageRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE '.nuget/packages' }
    foreach ($notice in @(
        @{ Package = 'microsoft.netcore.app.runtime.win-x64'; Name = 'LICENSE.TXT' },
        @{ Package = 'microsoft.netcore.app.runtime.win-x64'; Name = 'THIRD-PARTY-NOTICES.TXT' },
        @{ Package = 'microsoft.windowsdesktop.app.runtime.win-x64'; Name = 'LICENSE' }
    )) {
        Copy-Item (Join-Path $packageRoot "$($notice.Package)/10.0.13/$($notice.Name)") (Join-Path $notices "$($notice.Package)-$($notice.Name)")
    }
    'INTERNAL-UNVALIDATED. Synthetic isolated CI only. DELIVERY_PAUSED remains active. Not approved for user delivery.' | Set-Content (Join-Path $payload 'INTERNAL-UNVALIDATED.txt') -Encoding utf8
    & $controller --internal-qa-manifest $payload $Version $ExpectedCommit
    if ($LASTEXITCODE -ne 0) { throw 'Independent QA manifest failed.' }
    & (Join-Path $output 'helper/Caiwu.Delivery.Host.exe') verify $payload
    if ($LASTEXITCODE -ne 0) { throw 'Payload dependency/hash verification failed.' }
    if (-not (Test-Path docs/acceptance/DELIVERY_PAUSED.md) -or (git rev-parse HEAD).Trim() -ne $ExpectedCommit -or @(git status --porcelain --untracked-files=normal).Count -ne 0) { throw 'Source identity or delivery hold changed before internal NSIS build.' }
    $installer = Join-Path $output "INTERNAL-UNVALIDATED-caiwu-$Version-win-x64-setup.exe"
    $helper = Join-Path $output 'helper/Caiwu.Delivery.Host.exe'
    & $compiler -V2 -NOCONFIG "-DPAYLOAD=$payload" "-DHELPER=$helper" "-DOUTPUT=$installer" "-DPRODUCT_VERSION=$Version" "$PSScriptRoot/installer/Caiwu.nsi"
    if ($LASTEXITCODE -ne 0) { throw 'Internal NSIS build failed.' }
    [ordered]@{
        classification = 'INTERNAL-UNVALIDATED'; sourceCommit = $ExpectedCommit; version = $Version
        deliveryPaused = $true; approvedForUserDelivery = $false; signed = $false
        installer = [ordered]@{ name = [IO.Path]::GetFileName($installer); bytes = (Get-Item $installer).Length; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() }
        payloadManifestSha256 = (Get-FileHash (Join-Path $payload 'payload-manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
    } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $output 'INTERNAL-UNVALIDATED.json') -Encoding utf8
} finally { Pop-Location }
