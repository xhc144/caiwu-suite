param(
    [ValidateRange(1, 100)] [int] $Repetitions = 12,
    [string] $OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$repository = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$project = Join-Path $repository "tests/Caiwu.Persistence.Sqlite.Tests/Caiwu.Persistence.Sqlite.Tests.csproj"
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repository ("artifacts/sqlite-create-race-windows/" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:DOTNET_HOST_PATH = (Get-Command dotnet -CommandType Application).Source

Push-Location $repository
try {
    & dotnet --info | Out-File (Join-Path $OutputDirectory "dotnet-info.txt")
    & dotnet restore $project --locked-mode
    if ($LASTEXITCODE -ne 0) { throw "Locked restore failed: $LASTEXITCODE" }

    # This includes the original 109 tests and all new dedicated-thread and
    # separate-process regressions, using synthetic temporary directories only.
    & dotnet test $project -c Release --no-restore --logger "trx;LogFileName=full.trx" --results-directory $OutputDirectory
    $fullExit = $LASTEXITCODE
    $runs = @()
    for ($iteration = 1; $iteration -le $Repetitions; $iteration++) {
        & dotnet test $project -c Release --no-build --no-restore --filter "FullyQualifiedName~RacingCreatorsNeverOverwriteTheWinner" --logger "trx;LogFileName=race-$iteration.trx" --results-directory $OutputDirectory
        $runs += [pscustomobject]@{ iteration = $iteration; exitCode = $LASTEXITCODE }
    }
    [pscustomobject]@{
        platform = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
        fullSuiteExitCode = $fullExit
        repetitions = $runs
    } | ConvertTo-Json -Depth 5 | Out-File (Join-Path $OutputDirectory "summary.json")
    if ($fullExit -ne 0 -or @($runs | Where-Object exitCode -ne 0).Count -gt 0) {
        throw "SQLite regression failed; inspect $OutputDirectory"
    }
    Write-Output "SQLite regressions passed; evidence: $OutputDirectory"
}
finally { Pop-Location }
