param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Push-Location $repoRoot
try {
    $sourceSha = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve source SHA.' }
    if (git status --porcelain -- src/Caiwu.Payroll tests/Caiwu.Payroll.Tests) { throw 'Commit module source before capturing evidence.' }
    dotnet run --project tests/Caiwu.Payroll.Tests/WindowsSmoke/Caiwu.Payroll.WindowsSmoke.csproj -c Release -- $OutputDirectory $sourceSha
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic new-implementation Windows smoke failed.' }
} finally { Pop-Location }
