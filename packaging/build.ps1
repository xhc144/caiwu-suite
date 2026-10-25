[CmdletBinding()]
param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    function Invoke-DotNet([string[]]$Arguments) {
        & dotnet @Arguments
        if ($LASTEXITCODE -ne 0) { throw "dotnet command failed ($LASTEXITCODE): $($Arguments -join ' ')" }
    }
    $artifactDirectory = Join-Path $projectRoot 'artifacts'
    $publishDirectory = Join-Path $artifactDirectory 'publish/win-x64'
    $deliveryPaused = Test-Path (Join-Path $projectRoot 'docs/acceptance/DELIVERY_PAUSED.md')
    New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
    Invoke-DotNet -Arguments @('build', 'Caiwu.slnx', '-c', 'Release', '--nologo')
    if (-not $SkipTests) {
        Get-ChildItem 'tests' -Filter '*.csproj' -Recurse | ForEach-Object {
            $projectText = Get-Content $_.FullName -Raw
            if ($_.FullName -match 'Caiwu.Acceptance|Caiwu.Desktop.FeatureTests' -or $projectText -match '<UseWPF>\s*true\s*</UseWPF>') {
                # The original regression has a historical copied catch expression; the independent owner adapts it.
                # Actual WPF acceptance is run below using its bounded, result-identity-checking runner.
                return
            } elseif ($projectText -match '<IsTestProject>\s*true\s*</IsTestProject>') {
                Invoke-DotNet -Arguments @('test', $_.FullName, '-c', 'Release', '--no-build', '--logger', 'trx', '--results-directory', (Join-Path $artifactDirectory 'test-results'))
            } elseif ($_.Name -eq 'IntegrationProbe.csproj') {
                $probeDirectory = Join-Path $artifactDirectory ('verification/core-probe-' + [Guid]::NewGuid().ToString('N'))
                Invoke-DotNet -Arguments @('run', '--project', $_.FullName, '-c', 'Release', '--no-build', '--', $probeDirectory)
            } elseif ($projectText -match '<OutputType>\s*Exe\s*</OutputType>') {
                Invoke-DotNet -Arguments @('run', '--project', $_.FullName, '-c', 'Release', '--no-build')
            } else {
                Invoke-DotNet -Arguments @('test', $_.FullName, '-c', 'Release', '--no-build', '--logger', 'trx', '--results-directory', (Join-Path $artifactDirectory 'test-results'))
            }
        }
    }
    if (-not $deliveryPaused) {
        Invoke-DotNet -Arguments @('publish', 'src/Caiwu.Desktop/Caiwu.Desktop.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=false', '-o', $publishDirectory)
    }
    if (-not $SkipTests) {
        # Authentication is exercised by the independent synthetic-identity host.
        # Product startup has no smoke switch or test identity. The held path
        # also avoids RID restore mutating tracked source lock files.
        & ./tests/Caiwu.Acceptance/Wpf/run.ps1 -OutputDirectory (Join-Path $artifactDirectory 'independent-acceptance')
    }
    if ($deliveryPaused -or (Test-Path (Join-Path $projectRoot 'docs/acceptance/DELIVERY_PAUSED.md'))) {
        Write-Warning 'Independent acceptance has paused delivery. Tests and WPF evidence were generated; no distribution archive or installer is produced.'
        return
    }
    Copy-Item 'packaging/Install-Preview.ps1' $publishDirectory
    Copy-Item 'packaging/使用说明.txt' $publishDirectory
    $revision = (& git rev-parse --short HEAD).Trim()
    $manifest = [ordered]@{
        product = 'Caiwu Desktop Preview'; version = '0.1.0-preview'; commit = $revision
        runtime = 'net10.0-windows / win-x64 / self-contained'; productionValidated = $false
        files = @(Get-ChildItem $publishDirectory -File -Recurse | Sort-Object FullName | ForEach-Object {
            [ordered]@{ path = [IO.Path]::GetRelativePath($publishDirectory, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        })
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $artifactDirectory 'package-manifest.json') -Encoding utf8
    $package = Join-Path $artifactDirectory "caiwu-preview-win-x64-$revision.zip"
    Compress-Archive -Path (Join-Path $publishDirectory '*') -DestinationPath $package -Force
    [ordered]@{ file = [IO.Path]::GetFileName($package); bytes = (Get-Item $package).Length; sha256 = (Get-FileHash $package -Algorithm SHA256).Hash.ToLowerInvariant() } |
        ConvertTo-Json | Set-Content (Join-Path $artifactDirectory 'package-sha256.json') -Encoding utf8
    Write-Output "Preview package: $package"
} finally { Pop-Location }
