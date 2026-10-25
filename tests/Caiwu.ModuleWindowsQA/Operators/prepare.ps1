param([string]$Evidence = 'artifacts/module-operators-qa')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
$pin = '1957435365390756fd8267937fd0ec408b1e498f'
Push-Location $root
try {
    $expected = @{
        'src/Caiwu.Operators' = '188771cbe328f6c41af5ab937cc370ef566ee282'
        'src/Caiwu.Desktop/Themes' = '72ad713d1368a3b6cb78d094dc52fc7b328277fc'
        'src/Caiwu.Core' = 'a4a0239e97b433708fe727d9e4ee2eca03ca793b'
        'src/Caiwu.Contracts' = '5282011ae8b5e38250e22310c3006a5a02dc373d'
    }
    foreach ($path in $expected.Keys) {
        $actual = (git rev-parse "HEAD:$path").Trim()
        if ($LASTEXITCODE -ne 0 -or $actual -ne $expected[$path]) { throw "Pinned source tree changed: $path" }
    }
    $dirty = @(git status --porcelain --untracked-files=normal -- src tests/Caiwu.ModuleWindowsQA/Operators)
    if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) { throw 'Source provenance requires a clean committed checkout.' }
    $scratch = Join-Path $root '.tools/operators-baseline'
    New-Item -ItemType Directory -Force $scratch | Out-Null
    $archive = Join-Path $root '.tools/operators-baseline.tar'
    git archive -o $archive $pin tests/Caiwu.Operators.Tests/Run-WindowsSmoke.ps1 tests/Caiwu.Operators.Tests/WindowsSmoke
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the pinned author smoke probe.' }
    tar -xf $archive -C $scratch
    if ($LASTEXITCODE -ne 0) { throw 'Cannot materialize the pinned author smoke probe.' }
    foreach ($directory in @('src', 'packaging-next')) {
        $sourceLink = Join-Path $scratch $directory
        if (-not (Test-Path $sourceLink)) { New-Item -ItemType Junction -Path $sourceLink -Target (Join-Path $root $directory) | Out-Null }
    }
    $target = if ([IO.Path]::IsPathFullyQualified($Evidence)) { $Evidence } else { Join-Path $root $Evidence }
    New-Item -ItemType Directory -Force $target | Out-Null
    $files = @(git ls-files tests/Caiwu.ModuleWindowsQA/Operators .github/workflows/operators-windows-qa.yml)
    $manifest = @($files | ForEach-Object { @{ path = $_; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant(); gitBlob = (git rev-parse "HEAD:$_").Trim() } })
    @{
        checkoutCommit = (git rev-parse HEAD).Trim()
        productionSourceTree = (git rev-parse HEAD:src).Trim()
        pinnedOperatorsCommit = $pin
        pinnedModernCommit = '98a43e0'
        coreContract = 'v1.2'
        trees = $expected
        originalSmokeScriptBlob = (git rev-parse "${pin}:tests/Caiwu.Operators.Tests/Run-WindowsSmoke.ps1").Trim()
        originalCompositionBlob = (git rev-parse "${pin}:tests/Caiwu.Operators.Tests/WindowsSmoke/DesktopCompositionExample.cs").Trim()
        files = $manifest
    } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $target 'source-hashes.json') -Encoding utf8
} finally { Pop-Location }
