param([string]$Artifacts = "$PSScriptRoot/../../artifacts/summary-manager")
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This regression launches actual WPF windows and requires Windows with an interactive desktop.' }
$project = "$PSScriptRoot/WindowsSmoke/Caiwu.Summaries.WindowsSmoke.csproj"
dotnet restore $project --locked-mode
if ($LASTEXITCODE -ne 0) { throw 'Summary manager regression restore failed.' }
dotnet run --project $project --no-restore --configuration Release -p:TreatWarningsAsErrors=true -- $Artifacts
if ($LASTEXITCODE -ne 0) { throw 'Summary manager regression failed. Inspect smoke.json and captured PNGs.' }
