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
        @{ name='sqlite'; path='tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj' }
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
    if ($CaptureNative) {
        Invoke-EvidenceStep 'native-product-rendering-diagnostic' {
            # Existing capture harness runs only self-authored WPF with synthetic identities/books.
            # Its PNGs establish rendering of this SHA; original UI parity stays not-tested.
            & ./tests/Caiwu.Acceptance/HighResolution/run.ps1 -OutputDirectory (Join-Path $OutputDirectory 'native')
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
