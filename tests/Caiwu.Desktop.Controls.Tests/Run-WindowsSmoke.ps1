param([string]$Artifacts = "$PSScriptRoot/../../artifacts/reference-dialogs")
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This smoke launches real WPF windows and requires Windows.' }
$project = "$PSScriptRoot/WindowsSmoke/Caiwu.Desktop.Controls.WindowsSmoke.csproj"
dotnet restore $project --configfile "$PSScriptRoot/NuGet.Config" --locked-mode
if ($LASTEXITCODE -ne 0) { throw 'Windows smoke restore failed.' }
dotnet run --project $project --no-restore --configuration Release -p:TreatWarningsAsErrors=true -- $Artifacts
if ($LASTEXITCODE -ne 0) { throw 'Windows smoke failed.' }
