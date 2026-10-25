[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'tests/Caiwu.Acceptance/evidence/runtime/wpf' }
$env:CAIWU_ACCEPTANCE_CHECKOUT_COMMIT = (& git -C $root rev-parse HEAD).Trim()
$build = Join-Path $root 'tests/Caiwu.Acceptance/.build'
& dotnet build (Join-Path $PSScriptRoot 'Caiwu.Acceptance.Wpf.csproj') -c Release --artifacts-path $build --nologo
if ($LASTEXITCODE -ne 0) { throw 'Independent WPF harness build failed.' }
& dotnet (Join-Path $build 'bin/Caiwu.Acceptance.Wpf/release/Caiwu.Acceptance.Wpf.dll') $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'Independent WPF probes failed; read wpf-results.json.' }
