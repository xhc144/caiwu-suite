param([string]$OutputDirectory = 'artifacts/operators-windows', [int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Actual Windows is required.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$project = Join-Path $PSScriptRoot 'WindowsSmoke/Caiwu.Operators.WindowsSmoke.csproj'
dotnet build $project -c Release --nologo
if ($LASTEXITCODE -ne 0) { throw 'Operators WPF smoke build failed.' }
$env:CAIWU_OPERATORS_COMMIT = (git -C $repo rev-parse HEAD).Trim()
$target = if ([IO.Path]::IsPathFullyQualified($OutputDirectory)) { $OutputDirectory } else { Join-Path $repo $OutputDirectory }
$target = [IO.Path]::GetFullPath($target)
New-Item -ItemType Directory -Force $target | Out-Null
$dll = Join-Path $PSScriptRoot 'WindowsSmoke/bin/Release/net10.0-windows/Caiwu.Operators.WindowsSmoke.dll'
$arguments = '"{0}" "{1}"' -f $dll, $target
$process = Start-Process dotnet -ArgumentList $arguments -PassThru -RedirectStandardOutput (Join-Path $target 'stdout.txt') -RedirectStandardError (Join-Path $target 'stderr.txt')
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill($true)
    throw "Operators smoke exceeded $TimeoutSeconds seconds; actual UI outcome is incomplete."
}
if ($process.ExitCode -ne 0) { throw "Operators WPF smoke failed with exit code $($process.ExitCode). See $target." }
Get-Content (Join-Path $target 'operators-windows-results.json')
