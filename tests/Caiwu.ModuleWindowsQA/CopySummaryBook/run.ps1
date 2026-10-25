[CmdletBinding()]
param(
    [ValidateSet('Voucher','Summary','BookTools')][string]$Module,
    [string]$OutputDirectory = "artifacts/copy-summary-book/$Module"
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'BLOCKED: actual Windows WPF desktop required.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$sha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve source SHA.' }
if ($env:GITHUB_SHA -and $env:GITHUB_SHA -ne $sha) { throw 'Checkout differs from CI SHA.' }
$dirty = & git -C $root status --porcelain --untracked-files=all -- src tests/Caiwu.ModuleWindowsQA/CopySummaryBook .github/workflows/module-copy-summary-qa.yml
if ($dirty) { throw 'Commit source before collecting evidence.' }
if (Test-Path $OutputDirectory) { throw 'Use a fresh evidence directory.' }
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
$env:CAIWU_MODULE_QA_COMMIT = $sha
$env:CAIWU_VOUCHER_COPY_COMMIT = $sha
$failed = $null
$cases = @()
function Invoke-Bounded([string]$Exe, [string[]]$Arguments, [string]$LogName, [int]$Seconds) {
    $quoted = @($Arguments | ForEach-Object { '"' + $_ + '"' })
    $p = Start-Process $Exe -ArgumentList $quoted -PassThru -RedirectStandardOutput (Join-Path $OutputDirectory "$LogName.stdout.log") -RedirectStandardError (Join-Path $OutputDirectory "$LogName.stderr.log")
    if (-not $p.WaitForExit($Seconds * 1000)) {
        $p.Kill($true)
        throw "FAIL/BLOCKED timeout: $LogName after $Seconds seconds."
    }
    if ($p.ExitCode -ne 0) { throw "FAIL: $LogName exit $($p.ExitCode)." }
}
try {
    if (-not (Test-Path (Join-Path $root 'docs/acceptance/DELIVERY_PAUSED.md'))) { throw 'Delivery hold must remain.' }
    switch ($Module) {
        'Voucher' {
            Invoke-Bounded (Get-Command pwsh).Source @('-NoProfile', '-File', "$PSScriptRoot/AuthorVoucher/run.ps1", '-OutputDirectory', $OutputDirectory) 'author-voucher' 240
            $result = Get-Content -Raw (Join-Path $OutputDirectory 'wpf-results.json') | ConvertFrom-Json
            if ($result.checkoutCommit -ne $sha -or $result.failures -ne 0) { throw 'Voucher evidence failed.' }
        }
        'Summary' {
            Invoke-Bounded (Get-Command pwsh).Source @('-NoProfile', '-File', "$PSScriptRoot/AuthorSummary/Run-WindowsSmoke.ps1", '-Artifacts', $OutputDirectory) 'author-summary' 240
            $result = Get-Content -Raw (Join-Path $OutputDirectory 'smoke.json') | ConvertFrom-Json
            if (-not $result.passed) { throw 'Summary evidence failed.' }
        }
        'BookTools' {
            $project = "$PSScriptRoot/BookTools/Caiwu.CopySummaryBook.WindowsQA.csproj"
            Invoke-Bounded (Get-Command dotnet).Source @('build', $project, '-c', 'Release', '-warnaserror', '--nologo') 'build' 240
            $dll = "$PSScriptRoot/BookTools/bin/Release/net10.0-windows/Caiwu.CopySummaryBook.WindowsQA.dll"
            $caseNames = @('book-workarea-1024','book-workarea-1920','book-preview-cancel','book-full','book-opening','book-stale','book-busy-cancel','book-race','voucher-focus-sqlite','voucher-stale-sqlite','summary-bad-query')
            foreach ($caseName in $caseNames) {
                # Each modal flow owns a fresh process; continue independent cases after failure.
                try {
                    Invoke-Bounded (Get-Command dotnet).Source @($dll, $caseName, $OutputDirectory) $caseName 75
                    $r = Get-Content -Raw (Join-Path $OutputDirectory "$caseName.json") | ConvertFrom-Json
                    if (-not $r.passed -or $r.checkoutCommit -ne $sha) { throw 'Result failed or has wrong SHA.' }
                    $cases += @{ name = $caseName; passed = $true }
                } catch { $cases += @{ name = $caseName; passed = $false; error = $_.ToString() } }
            }
            if (@($cases | Where-Object { -not $_.passed }).Count -gt 0) { throw 'One or more actual Windows cases failed.' }
        }
    }
    # A case-level PNG receipt must still match after all processes have completed.
    # This detects accidental cross-case filename reuse as well as missing/corrupt images.
    foreach ($jsonFile in Get-ChildItem $OutputDirectory -Filter '*.json' -File) {
        $receipt = Get-Content -Raw $jsonFile.FullName | ConvertFrom-Json
        foreach ($capture in @($receipt.captures)) {
            if ($null -eq $capture) { continue }
            $capturePath = Join-Path $OutputDirectory $capture.file
            if (-not (Test-Path $capturePath) -or (Get-FileHash $capturePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $capture.sha256) {
                throw "Capture SHA256 mismatch in $($jsonFile.Name): $($capture.file)."
            }
        }
    }
} catch { $failed = $_.ToString() }
finally {
    $trees = @{}
    foreach ($path in @('src/Caiwu.Contracts','src/Caiwu.Core','src/Caiwu.Persistence.Sqlite','src/Caiwu.BookTools','src/Caiwu.VoucherTools','src/Caiwu.VoucherTools.Wpf','src/Caiwu.Summaries','src/Caiwu.Desktop/Themes','tests/Caiwu.ModuleWindowsQA/CopySummaryBook')) {
        $trees[$path] = (& git -C $root rev-parse "${sha}:$path").Trim()
    }
    $files = @(Get-ChildItem $OutputDirectory -File | ForEach-Object { @{ file = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
    @{ checkoutCommit = $sha; module = $Module; passed = ($null -eq $failed); error = $failed; cases = $cases; sourceTrees = $trees; files = $files; actualWindows = $IsWindows; inputMethod = 'See per-case receipts: workarea cases use native SendInput mouse; other cases use WPF RoutedEvent/property driving; no native keyboard/IME or multi-DPI claim'; timestampUtc = [DateTime]::UtcNow.ToString('O') } | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'evidence-manifest.json')
}
if ($failed) { throw $failed }
