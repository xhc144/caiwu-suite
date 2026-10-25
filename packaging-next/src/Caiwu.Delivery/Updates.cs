using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Caiwu.Delivery;

public sealed record UpdatePolicy(bool Enabled, string FeedUrl, string[] AllowedHosts, string[] PublisherThumbprints);
public sealed record UpdateCandidate(string Version, string Url, string Sha256, long Size);

public static class UpdateRules
{
    public const long MaximumInstallerSize = 512L * 1024 * 1024;
    public static Uri AllowedUri(UpdatePolicy policy, string value)
    {
        if (!policy.Enabled) throw new InvalidOperationException("Automatic updates are disabled until a trusted release channel is configured.");
        if (policy.PublisherThumbprints.Length == 0 || policy.PublisherThumbprints.Any(p => !Regex.IsMatch(p, "^[0-9a-fA-F]{40}$")))
            throw new InvalidDataException("Pinned Authenticode publisher certificate thumbprints are required.");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment) || !uri.IsDefaultPort ||
            !policy.AllowedHosts.Contains(uri.IdnHost, StringComparer.OrdinalIgnoreCase))
            throw new InvalidDataException("Update URLs must use HTTPS on an explicitly trusted host without credentials, fragments, or a custom port.");
        return uri;
    }
    public static void ValidateShape(UpdatePolicy policy, UpdateCandidate candidate)
    {
        _ = AllowedUri(policy, policy.FeedUrl); _ = AllowedUri(policy, candidate.Url);
        _ = PayloadManifest.ParseVersion(candidate.Version);
        if (!Regex.IsMatch(candidate.Sha256, "^[0-9a-fA-F]{64}$") || candidate.Size <= 0 || candidate.Size > MaximumInstallerSize)
            throw new InvalidDataException("A valid SHA256 and bounded installer size are required.");
    }
    public static void Validate(UpdatePolicy policy, UpdateCandidate candidate, string currentVersion)
    {
        ValidateShape(policy, candidate);
        if (PayloadManifest.ParseVersion(candidate.Version) <= PayloadManifest.ParseVersion(currentVersion)) throw new InvalidDataException("Update must advance the installed version.");
    }
}

public sealed class UpdateClient : IDisposable
{
    private readonly HttpClient http;
    public UpdateClient(HttpMessageHandler? handler = null)
    {
        http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.None })
            { Timeout = TimeSpan.FromMinutes(5) };
    }

    public async Task<UpdateCandidate?> CheckAsync(UpdatePolicy policy, string currentVersion, CancellationToken token = default)
    {
        var feed = UpdateRules.AllowedUri(policy, policy.FeedUrl);
        using var response = await http.GetAsync(feed, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > 65536) throw new InvalidDataException("Update feed is too large.");
        using var stream = await response.Content.ReadAsStreamAsync(token);
        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        int read;
        while ((read = await stream.ReadAsync(chunk, token)) != 0)
        {
            if (buffer.Length + read > 65536) throw new InvalidDataException("Update feed is too large.");
            buffer.Write(chunk, 0, read);
        }
        var candidate = JsonSerializer.Deserialize<UpdateCandidate>(buffer.ToArray(), PayloadManifest.Json) ?? throw new InvalidDataException("Empty update feed.");
        // Even a no-update response must contain a structurally safe URI and checksum.
        UpdateRules.ValidateShape(policy, candidate);
        if (PayloadManifest.ParseVersion(candidate.Version) <= PayloadManifest.ParseVersion(currentVersion)) return null;
        UpdateRules.Validate(policy, candidate, currentVersion);
        return candidate;
    }

    // SHA256 validation is only the download stage. Authenticode approval is a separate mandatory Windows gate.
    // This method never starts an installer.
    public async Task<string> DownloadAsync(UpdatePolicy policy, UpdateCandidate candidate, string currentVersion, string stagingRoot, CancellationToken token = default)
    {
        UpdateRules.Validate(policy, candidate, currentVersion);
        stagingRoot = SafePaths.Full(stagingRoot); Directory.CreateDirectory(stagingRoot);
        var path = SafePaths.Child(stagingRoot, "caiwu-" + candidate.Version + "-" + Guid.NewGuid().ToString("N") + ".untrusted");
        try
        {
            using var response = await http.GetAsync(UpdateRules.AllowedUri(policy, candidate.Url), HttpCompletionOption.ResponseHeadersRead, token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength is long length && length != candidate.Size) throw new InvalidDataException("Installer response size mismatch.");
            using (var input = await response.Content.ReadAsStreamAsync(token))
            using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                var buffer = new byte[81920]; long received = 0; int count;
                while ((count = await input.ReadAsync(buffer, token)) != 0)
                {
                    received += count;
                    if (received > candidate.Size) throw new InvalidDataException("Installer exceeds declared size.");
                    await output.WriteAsync(buffer.AsMemory(0, count), token);
                }
                if (received != candidate.Size) throw new InvalidDataException("Truncated installer.");
                output.Flush(flushToDisk: true);
            }
            if (!PayloadManifest.Hash(path).Equals(candidate.Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Installer SHA256 mismatch.");
            return path;
        }
        catch { if (File.Exists(path)) File.Delete(path); throw; }
    }
    public void Dispose() => http.Dispose();
}
