param([string]$Evidence = 'artifacts/module-operators-qa', [int]$TimeoutSeconds = 180)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Actual Windows/WPF required. Linux cross-build is not an interaction result.' }
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
Push-Location $root
try {
    $target = if ([IO.Path]::IsPathFullyQualified($Evidence)) { $Evidence } else { Join-Path $root $Evidence }
    New-Item -ItemType Directory -Force $target | Out-Null
    $env:CAIWU_OPERATORS_QA_COMMIT = (git rev-parse HEAD).Trim()
    $env:CAIWU_OPERATORS_QA_SOURCE_TREE = (git rev-parse HEAD:src).Trim()
    $project = Join-Path $PSScriptRoot 'Caiwu.ModuleWindowsQA.Operators.csproj'
    dotnet restore $project --locked-mode --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Focused Operators lockfile restore failed.' }
    dotnet build $project -c Release --nologo -warnaserror --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Focused Operators component host build failed.' }
    $executable = Join-Path $PSScriptRoot 'bin/Release/net10.0-windows/Caiwu.ModuleWindowsQA.Operators.exe'
    $process = Start-Process $executable -ArgumentList ('"' + $target + '"') -PassThru -RedirectStandardOutput "$target/stdout.log" -RedirectStandardError "$target/stderr.log"
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { $process.Kill($true); throw 'Operators Windows watchdog expired; partial evidence remains incomplete.' }
    if ($process.ExitCode -ne 0) { throw "Operators component probe failed ($($process.ExitCode)); inspect results.json." }
    $result = Get-Content "$target/results.json" -Raw | ConvertFrom-Json
    $expected = @('FIRST-USE-CANCEL-NO-IDENTITY', 'FIRST-USE-VALIDATION-EXPLICIT-LOGIN-CANCEL', 'LOGIN-WRONG-PASSWORD-RETAINS-WINDOW-NATIVE-ENTER', 'LOGIN-CANCEL-CLEARS-SECRET', 'ADMIN-MANAGEMENT-ADD-ROLE-CHANGE-DISABLE', 'NONADMIN-MANAGEMENT-REJECTED', 'AUTHORIZED-CORE-SQLITE-CLOSED-LOOP-ACTOR-BOUNDARY', 'SAME-BOOK-DIFFERENT-PHYSICAL-SESSION-STALE-EDITOR', 'PASSWORD-CHANGE-REVOKES-OLD-SESSION', 'LOGOUT-OLD-ADAPTER-AND-FACTORY-REMAIN-REVOKED')
    if ($result.checkoutCommit -ne $env:CAIWU_OPERATORS_QA_COMMIT -or $result.productionSourceTree -ne $env:CAIWU_OPERATORS_QA_SOURCE_TREE -or -not $result.windowsExecuted -or -not $result.independentComponentHost -or $result.productAppStartupTested -or $result.nativeSendInputEvents -lt 100 -or @($result.results).Count -ne $expected.Count -or @($result.results | Where-Object { -not $_.Passed }).Count -gt 0) { throw 'Windows result failed completeness/source/native-input checks.' }
    foreach ($id in $expected) { if (@($result.results | Where-Object Id -eq $id).Count -ne 1) { throw "Missing or duplicated scenario $id" } }
    $images = @('first-use-validation', 'login-rejected', 'management-synthetic', 'stale-physical-editor', 'password-change-rejected')
    foreach ($image in $images) { if (-not (Test-Path "$target/$image.png")) { throw "Missing synthetic window capture: $image" } }
    Write-Output 'Operators independent Windows component host passed. Product App startup, IME and screen reader remain separate.'
} finally { Pop-Location }
