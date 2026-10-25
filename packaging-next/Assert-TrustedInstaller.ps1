[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$ExpectedVersion,
    [Parameter(Mandatory)][string]$CurrentVersion,
    [Parameter(Mandatory)][string[]]$PublisherThumbprints
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Authenticode verification requires Windows.' }
if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $PublisherThumbprints.Count -eq 0 -or
    @($PublisherThumbprints | Where-Object { $_ -notmatch '^[0-9a-fA-F]{40}$' }).Count -gt 0) { throw 'Expected digest and installed publisher pins are required.' }
if ([Version]$ExpectedVersion -le [Version]$CurrentVersion) { throw 'Installer version must advance the active version.' }
$path = [IO.Path]::GetFullPath($Installer)
# Keep the file read-only to other opens during all verification steps.
$lease = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Installer changed after download.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { throw 'Installer must have a valid Windows-trusted Authenticode signature.' }
    if ($signature.SignerCertificate.Thumbprint -notin $PublisherThumbprints) { throw 'Installer publisher certificate is not pinned by the installed policy.' }
    $metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
    if ($metadata.FileVersion -ne $ExpectedVersion -or $metadata.ProductName -ne 'Caiwu Suite Development Preview') { throw 'Signed installer product/version does not match the update candidate.' }
    [pscustomobject]@{ status = 'verified'; version = $ExpectedVersion; sha256 = $ExpectedSha256; publisher = $signature.SignerCertificate.Thumbprint }
} finally { $lease.Dispose() }
# This verifier never launches any process or modifies certificate/security stores.
