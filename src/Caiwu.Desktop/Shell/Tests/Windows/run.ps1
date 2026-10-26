param([string]$OutputDirectory = 'artifacts/parity-shell-native')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Actual Windows WPF is required; no original program is launched.' }
$env:CAIWU_SHELL_SOURCE_SHA = (git rev-parse HEAD).Trim()
dotnet run --project "$PSScriptRoot/Caiwu.Shell.Windows.Tests.csproj" -c Release -- $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw "Native shell verification failed ($LASTEXITCODE)." }
