[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$ExpectedCommit,
    [string]$OutputDirectory = 'artifacts/parity-windows',
    [switch]$CaptureNative
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Actual Windows is required; cross-compilation is not Windows evidence.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $root
function Assert-ExactSource {
    $actual = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -cne $ExpectedCommit) { throw 'Checkout does not match the exact requested SHA.' }
    $changes = @(& git status --porcelain=v1 --untracked-files=normal)
    if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) { throw 'Source checkout is dirty; no clean-SHA result may be issued.' }
}
Assert-ExactSource
if ((& dotnet --version).Trim() -cne '10.0.402') { throw 'The pinned SDK 10.0.402 is required.' }
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:CAIWU_PARITY_COMMIT = $ExpectedCommit
$env:CAIWU_PARITY_TREE = (& git rev-parse 'HEAD^{tree}').Trim()
$env:CAIWU_PARITY_SOURCE_CLEAN = 'true'
$steps = [System.Collections.Generic.List[object]]::new()
$failed = $false
function Invoke-EvidenceStep([string]$Name, [scriptblock]$Action) {
    try {
        & $Action
        $steps.Add(@{ name = $Name; status = 'passed' })
    } catch {
        $script:failed = $true
        $steps.Add(@{ name = $Name; status = 'failed'; error = $_.Exception.Message })
        Write-Warning "$Name failed: $($_.Exception.Message)"
    }
}
try {
    foreach ($item in @(
        @{ name='core'; path='tests/Caiwu.Core.Tests/Caiwu.Core.Tests.csproj' },
        @{ name='sqlite'; path='tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj' },
        @{ name='book-copy'; path='tests/Caiwu.BookTools.Tests/Caiwu.BookTools.Tests.csproj' }
    )) {
        $project = $item.path; $name = $item.name
        Invoke-EvidenceStep $name {
            & dotnet restore $project --locked-mode --nologo
            if ($LASTEXITCODE -ne 0) { throw "Locked restore failed: $project" }
            & dotnet test $project -c Release --no-restore -p:TreatWarningsAsErrors=true --nologo --logger "trx;LogFileName=$name.trx" --results-directory $OutputDirectory
            if ($LASTEXITCODE -ne 0) { throw "Tests failed: $project" }
        }
    }
    Invoke-EvidenceStep 'atomic-module-sqlite-integration' {
        $project = 'tests/ParityAcceptance/Caiwu.ParityAcceptance.csproj'
        & dotnet restore $project --locked-mode --nologo
        if ($LASTEXITCODE -ne 0) { throw 'Acceptance locked restore failed.' }
        & dotnet run --project $project -c Release --no-restore -p:TreatWarningsAsErrors=true -- (Join-Path $OutputDirectory 'integration.json')
        if ($LASTEXITCODE -ne 0) { throw 'Actual SQLite integration failed.' }
        $result = Get-Content -Raw (Join-Path $OutputDirectory 'integration.json') | ConvertFrom-Json
        if ($result.sourceCommit -cne $ExpectedCommit -or $result.sourceBinding -cne 'exact-clean-checkout' -or $result.status -cne 'passed') { throw 'Integration evidence identity or result mismatch.' }
    }
    Invoke-EvidenceStep 'delivery-security-and-managed-schema' {
        $project = 'tests/Caiwu.Delivery.Tests/Caiwu.Delivery.Tests.csproj'
        & dotnet restore $project --locked-mode --nologo
        if ($LASTEXITCODE -ne 0) { throw 'Delivery locked restore failed.' }
        & dotnet run --project $project -c Release --no-restore -p:TreatWarningsAsErrors=true -- (Join-Path $OutputDirectory 'delivery-components.json')
        if ($LASTEXITCODE -ne 0) { throw 'Delivery safety regressions failed.' }
    }
    if (Test-Path 'tests/ParityAcceptance/Authorization/Caiwu.ParityAuthorization.csproj') {
        Invoke-EvidenceStep 'real-session-preview-core-sqlite-and-cashier' {
            $project = 'tests/ParityAcceptance/Authorization/Caiwu.ParityAuthorization.csproj'
            & dotnet restore $project --locked-mode --nologo
            if ($LASTEXITCODE -ne 0) { throw 'Protected composition locked restore failed.' }
            & dotnet run --project $project -c Release --no-restore -p:TreatWarningsAsErrors=true -- (Join-Path $OutputDirectory 'authorized-integration.json')
            if ($LASTEXITCODE -ne 0) { throw 'Actual protected Core/SQLite composition failed.' }
        }
    }
    if (Test-Path 'tests/Caiwu.Cashier.Tests/WindowsRegression/Caiwu.Cashier.WindowsRegression.csproj') {
        Invoke-EvidenceStep 'cashier-wpf-cas-boundary-synthetic-ledger-double' {
            $project = 'tests/Caiwu.Cashier.Tests/WindowsRegression/Caiwu.Cashier.WindowsRegression.csproj'
            & dotnet restore $project --locked-mode --nologo
            if ($LASTEXITCODE -ne 0) { throw 'Cashier native regression locked restore failed.' }
            & dotnet build $project -c Release --no-restore -p:TreatWarningsAsErrors=true --nologo
            if ($LASTEXITCODE -ne 0) { throw 'Cashier native regression build failed.' }
            $dll = Join-Path $root 'tests/Caiwu.Cashier.Tests/WindowsRegression/bin/Release/net10.0-windows/Caiwu.Cashier.WindowsRegression.dll'
            $process = Start-Process (Get-Command dotnet).Source -ArgumentList ('"' + $dll + '"') -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory 'cashier-wpf-stdout.log') -RedirectStandardError (Join-Path $OutputDirectory 'cashier-wpf-stderr.log')
            if (-not $process.WaitForExit(60000)) { $process.Kill($true); throw 'Cashier WPF regression timed out.' }
            if ($process.ExitCode -ne 0) { throw 'Cashier WPF regression failed; inspect logs.' }
        }
    }
    if ($CaptureNative) {
        Invoke-EvidenceStep 'native-product-rendering-diagnostic' {
            # Existing capture harness runs only self-authored WPF with synthetic identities/books.
            # Its PNGs establish rendering of this SHA; original UI parity stays not-tested.
            if (Test-Path 'src/Caiwu.Desktop/Shell/Tests/Windows/run.ps1') {
                $nativeOutput = Join-Path $OutputDirectory 'native'
                New-Item -ItemType Directory -Force $nativeOutput | Out-Null
                & dotnet build src/Caiwu.Desktop/Shell/Tests/Windows/Caiwu.Shell.Windows.Tests.csproj -c Release -p:TreatWarningsAsErrors=true --nologo
                if ($LASTEXITCODE -ne 0) { throw 'Candidate shell native host build failed.' }
                $env:CAIWU_SHELL_SOURCE_SHA = $ExpectedCommit
                $hostDll = Join-Path $root 'src/Caiwu.Desktop/Shell/Tests/Windows/bin/Release/net10.0-windows/Caiwu.Shell.Windows.Tests.dll'
                $desktopRunner = Join-Path $root 'tests/ParityAcceptance/run-native-host.py'
                $nativeProcess = Start-Process (Get-Command python).Source -ArgumentList @(('"' + $desktopRunner + '"'), ('"' + (Get-Command dotnet).Source + '"'), ('"' + $hostDll + '"'), ('"' + $nativeOutput + '"')) -PassThru -RedirectStandardOutput (Join-Path $nativeOutput 'stdout.log') -RedirectStandardError (Join-Path $nativeOutput 'stderr.log')
                if (-not $nativeProcess.WaitForExit(90000)) { $nativeProcess.Kill($true); throw 'Candidate shell native host timed out; no UI pass inferred.' }
                if ($nativeProcess.ExitCode -ne 0) { throw 'Candidate shell native host failed.' }
                $shell = Get-Content -Raw (Join-Path $OutputDirectory 'native/native-shell.json') | ConvertFrom-Json
                if (-not $shell.succeeded -or $shell.sourceSha -cne $ExpectedCommit) { throw 'Candidate native shell identity/result mismatch.' }
            } else {
                & ./tests/Caiwu.Acceptance/HighResolution/run.ps1 -OutputDirectory (Join-Path $OutputDirectory 'native')
            }
            if ($LASTEXITCODE -ne 0) { throw 'Native product capture failed.' }
        }
    }
    Invoke-EvidenceStep 'source-still-exact' { Assert-ExactSource }
} finally {
    $files = @(Get-ChildItem $OutputDirectory -Recurse -File | Where-Object { $_.Name -ne 'windows-run.json' } | ForEach-Object {
        @{ path = [IO.Path]::GetRelativePath($OutputDirectory, $_.FullName); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = $_.Length }
    })
    @{
        schemaVersion = 1; sourceCommit = $ExpectedCommit; sourceTree = $env:CAIWU_PARITY_TREE;
        actualWindows = $true; syntheticOnly = $true; originalProgramExecuted = $false;
        originalUiParity = 'not-tested'; realBookCompatibility = 'not-tested'; fullProductAcceptance = 'not-tested';
        nativeCaptureRequested = [bool]$CaptureNative;
        status = $(if ($failed) { 'failed' } else { 'passed' });
        steps = $steps.ToArray(); files = $files
    } | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'windows-run.json')
}
if ($failed) { throw 'One or more exact-SHA Windows component steps failed; inspect windows-run.json.' }
