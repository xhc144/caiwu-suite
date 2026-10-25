param([string]$Evidence = "artifacts/desktop-features-windows")
$ErrorActionPreference = "Stop"
if (-not $IsWindows) { throw "Actual Windows/WPF execution required; Linux cross-build is not execution." }
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
Push-Location $root
try {
    dotnet build "$PSScriptRoot/Caiwu.Desktop.FeatureTests.Windows.csproj" -c Release -warnaserror
    if ($LASTEXITCODE -ne 0) { throw "Windows probe build failed." }
    New-Item -ItemType Directory -Force $Evidence | Out-Null
    git rev-parse HEAD | Set-Content "$Evidence/checkout-sha.txt"
    dotnet run --project "$PSScriptRoot/Caiwu.Desktop.FeatureTests.Windows.csproj" -c Release --no-build -- $Evidence
    if ($LASTEXITCODE -ne 0) { throw "Feature window probes failed; inspect result JSON and PNG." }
} finally { Pop-Location }
