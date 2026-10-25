param([string]$Evidence = "artifacts/desktop-features-windows")
$ErrorActionPreference = "Stop"
if (-not $IsWindows) { throw "Actual Windows/WPF execution required; Linux cross-build is not execution." }
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
Push-Location $root
try {
    $dirty = @(git status --porcelain --untracked-files=normal -- src packaging-next/src tests/Caiwu.Desktop.FeatureTests)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw "Source identity requires a clean checkout: $($dirty -join '; ')" }
    $env:CAIWU_FEATURE_CHECKOUT_COMMIT = (git rev-parse HEAD).Trim()
    $env:CAIWU_FEATURE_SOURCE_TREE = (git rev-parse HEAD:src).Trim()
    dotnet build "$PSScriptRoot/Caiwu.Desktop.FeatureTests.Windows.csproj" -c Release -warnaserror
    if ($LASTEXITCODE -ne 0) { throw "Windows probe build failed." }
    New-Item -ItemType Directory -Force $Evidence | Out-Null
    $Evidence = (Resolve-Path $Evidence).Path
    $env:CAIWU_FEATURE_CHECKOUT_COMMIT | Set-Content "$Evidence/checkout-sha.txt"
    $executable = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.Desktop.FeatureTests.Windows.exe'
    $process = Start-Process -FilePath $executable -ArgumentList ('"' + $Evidence + '"') -PassThru -RedirectStandardOutput "$Evidence/stdout.log" -RedirectStandardError "$Evidence/stderr.log"
    if (-not $process.WaitForExit(110000)) { $process.Kill($true); throw 'Feature window watchdog expired; inspect partial evidence.' }
    if ($process.ExitCode -ne 0) { throw "Feature window probes failed ($($process.ExitCode)); inspect result JSON and PNG." }
    $result = Get-Content "$Evidence/results.json" -Raw | ConvertFrom-Json
    if ($result.checkoutCommit -ne $env:CAIWU_FEATURE_CHECKOUT_COMMIT -or $result.productionSourceTree -ne $env:CAIWU_FEATURE_SOURCE_TREE -or -not $result.windowsExecuted -or @($result.results | Where-Object { -not $_.passed }).Count -ne 0 -or @($result.results).Count -ne 14) { throw 'Feature result is incomplete, failed, or belongs to another source.' }
} finally { Pop-Location }
