param([string]$OutputDirectory = (Join-Path $env:TEMP ("caiwu-designer-" + [guid]::NewGuid().ToString('N'))), [switch]$Interactive)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) { throw 'Windows is required for actual WPF execution.' }
$project = Join-Path $PSScriptRoot 'WindowsSmoke/Caiwu.ReportDesigner.WindowsSmoke.csproj'
dotnet restore $project --locked-mode
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
dotnet build $project --no-restore -c Release -p:TreatWarningsAsErrors=true
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$dll = Join-Path $PSScriptRoot 'WindowsSmoke/bin/Release/net10.0-windows/Caiwu.ReportDesigner.WindowsSmoke.dll'
$cliArgs = @($dll, [IO.Path]::GetFullPath($OutputDirectory))
if ($Interactive) { $cliArgs += '--interactive' }
$process = Start-Process dotnet -ArgumentList ($cliArgs | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -PassThru -NoNewWindow
if (-not $process.WaitForExit($(if ($Interactive) { 600000 } else { 90000 }))) { $process.Kill(); throw 'WPF smoke watchdog timed out.' }
if ($process.ExitCode -ne 0) { throw "WPF smoke failed ($($process.ExitCode)); evidence: $OutputDirectory" }
if (-not $Interactive) { $result = Get-Content (Join-Path $OutputDirectory 'smoke.json') -Raw | ConvertFrom-Json; if (-not $result.Passed) { throw 'smoke.json reports failure.' } }
Write-Output "Completed; evidence: $OutputDirectory. No printer/PDF/physical-keyboard certification is implied."
