using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Caiwu.Delivery;

public sealed record PayloadFile(string Path, long Bytes, string Sha256);
public sealed record PayloadManifest(string Version, string Commit, bool ManagedDataContract, PayloadFile[] Files)
{
    public const string FileName = "payload-manifest.json";
    public static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    public static System.Version ParseVersion(string version)
    {
        if (!Regex.IsMatch(version, @"^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$") ||
            !System.Version.TryParse(version, out var result) || new[] { result.Major, result.Minor, result.Build, result.Revision }.Any(x => x > 65535))
            throw new InvalidDataException("Version must contain four canonical 0..65535 components.");
        return result;
    }
    public static string Hash(string path)
    {
        using var file = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(file));
    }
    public static PayloadManifest Create(string payload, string version, string commit, bool managedDataContract = false)
    {
        ParseVersion(version);
        if (!Regex.IsMatch(commit, "^[0-9a-f]{40}$")) throw new InvalidDataException("A full source commit is required.");
        var files = SafePaths.Files(SafePaths.Full(payload))
            .Where(p => Path.GetRelativePath(payload, p) != FileName)
            .Select(p => new PayloadFile(Path.GetRelativePath(payload, p).Replace('\\', '/'), new FileInfo(p).Length, Hash(p)))
            .OrderBy(p => p.Path, StringComparer.Ordinal).ToArray();
        var manifest = new PayloadManifest(version, commit, managedDataContract, files);
        manifest.ValidateStructure(payload);
        return manifest;
    }
    public string Digest() => Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(this, Json) + "\n")));
    public void Write(string path) => File.WriteAllText(path, JsonSerializer.Serialize(this, Json) + "\n");
    public static PayloadManifest Read(string path) => JsonSerializer.Deserialize<PayloadManifest>(File.ReadAllText(path), Json)
        ?? throw new InvalidDataException("Missing manifest.");
    internal void ValidateStructure(string payload)
    {
        ParseVersion(Version);
        if (!Regex.IsMatch(Commit, "^[0-9a-f]{40}$") || Files.Length == 0) throw new InvalidDataException("Invalid manifest provenance or empty payload.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Files)
        {
            _ = SafePaths.Child(payload, file.Path);
            if (!seen.Add(file.Path.Replace('\\', '/')) || file.Path.Equals(FileName, StringComparison.OrdinalIgnoreCase) ||
                file.Bytes < 0 || !Regex.IsMatch(file.Sha256, "^[0-9a-f]{64}$")) throw new InvalidDataException("Invalid or duplicate payload entry.");
            if (new[] { ".caiwu", ".caiwubak", ".db", ".sqlite", ".sqlite3", ".bak" }.Contains(System.IO.Path.GetExtension(file.Path), StringComparer.OrdinalIgnoreCase) ||
                file.Path.EndsWith("-wal", StringComparison.OrdinalIgnoreCase) || file.Path.EndsWith("-shm", StringComparison.OrdinalIgnoreCase) || file.Path.EndsWith("-journal", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Ledger/backup files may not be distributed as program payload.");
        }
    }
    public void Verify(string payload)
    {
        payload = SafePaths.Full(payload); ValidateStructure(payload);
        var actual = SafePaths.Files(payload).Select(p => System.IO.Path.GetRelativePath(payload, p).Replace('\\', '/'))
            .Where(p => p != FileName).ToHashSet(StringComparer.Ordinal);
        if (!actual.SetEquals(Files.Select(f => f.Path))) throw new InvalidDataException("Payload has missing or unlisted files.");
        foreach (var file in Files)
        {
            var path = SafePaths.Child(payload, file.Path);
            if (new FileInfo(path).Length != file.Bytes || Hash(path) != file.Sha256) throw new InvalidDataException($"Payload checksum mismatch: {file.Path}");
        }
    }
}
