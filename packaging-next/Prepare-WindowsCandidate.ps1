[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidatePattern('^\d+\.\d+\.\d+\.\d+$')][string]$Version = '0.1.0.1'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    function Assert-CleanSource {
        $state = @(git status --porcelain --untracked-files=normal)
        if ($LASTEXITCODE -ne 0 -or $state.Count -ne 0) { throw "Exact source identity requires a clean checkout: $($state -join '; ')" }
    }
    function Invoke-DotNet([string[]]$Arguments) {
        & dotnet @Arguments
        if ($LASTEXITCODE -ne 0) { throw "dotnet failed: $($Arguments -join ' ')" }
    }
    Assert-CleanSource
    $commit = (git rev-parse HEAD).Trim()
    $sourceTree = (git rev-parse HEAD:src).Trim()
    if ((dotnet --version).Trim() -ne '10.0.402') { throw 'Exact SDK 10.0.402 required.' }
    $out = [IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $out) { throw 'Preparation output must be a new directory.' }
    New-Item -ItemType Directory -Path $out | Out-Null
    $common = @("-p:CustomAfterMicrosoftCommonTargets=$root/packaging-next/Delivery.restore.targets", '-p:RuntimeFrameworkVersion=10.0.13', '-p:TargetLatestRuntimePatch=false', '-p:DeliveryLibraryOnly=true')
    $identity = @("-p:Version=$Version", "-p:AssemblyVersion=$Version", "-p:FileVersion=$Version", "-p:InformationalVersion=$Version+$commit", "-p:SourceRevisionId=$commit", '-p:ContinuousIntegrationBuild=true', "-p:PathMap=$root=/_/", '-p:DebugType=embedded', '-p:PublishReadyToRun=false')
    foreach ($spec in @(
        @{ Project = 'src/Caiwu.Desktop/Caiwu.Desktop.csproj'; Graph = 'desktop'; Destination = 'payload'; Single = 'false' },
        @{ Project = 'packaging-next/src/Caiwu.Delivery.Host/Caiwu.Delivery.Host.csproj'; Graph = 'host'; Destination = 'helper'; Single = 'true' }
    )) {
        $properties = $common + @("-p:DeliveryLockGraph=$($spec.Graph)", "-p:PublishSingleFile=$($spec.Single)")
        if ($spec.Single -eq 'true') { $properties += '-p:IncludeNativeLibrariesForSelfExtract=true' }
        Invoke-DotNet (@('restore', $spec.Project, '-r', 'win-x64', '--locked-mode') + $properties)
        Assert-CleanSource
        Invoke-DotNet (@('publish', $spec.Project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '--no-restore', '-o', (Join-Path $out $spec.Destination)) + $properties + $identity)
        Assert-CleanSource
    }
    Copy-Item (Join-Path $out 'helper/Caiwu.Delivery.Host.exe') (Join-Path $out 'payload/Caiwu.Delivery.exe')
    Copy-Item "$PSScriptRoot/update-policy.disabled.json" (Join-Path $out 'payload/update-policy.json')
    [ordered]@{
        success = $true; checkoutCommit = $commit; productionSourceTree = $sourceTree
        sdk = '10.0.402'; runtime = '10.0.13'; rid = 'win-x64'; selfContained = $true
        deliveryPaused = (Test-Path 'docs/acceptance/DELIVERY_PAUSED.md')
        installerGenerated = $false; archiveGenerated = $false; installedRuntimeValidated = $false
        helperIncludesNativeModuleCodecs = $true
        files = @(Get-ChildItem (Join-Path $out 'payload') -Recurse -File | Sort-Object FullName | ForEach-Object {
            [ordered]@{ path = [IO.Path]::GetRelativePath((Join-Path $out 'payload'), $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        })
    } | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'preparation.json') -Encoding utf8
} finally { Pop-Location }
