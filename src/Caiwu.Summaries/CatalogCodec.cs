using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Caiwu.Summaries;

internal static class TextRules
{
    internal static string Normalize(string value) => value.Normalize(NormalizationForm.FormKC);
    internal static string Required(string? value, string label, int max, bool multiline = false)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new SummaryValidationException($"{label}不能为空或只有空白。");
        var trimmed = value.Trim();
        if (trimmed.Length > max || trimmed.Any(c => char.IsControl(c) && !(multiline && c is '\n' or '\r' or '\t')))
            throw new SummaryValidationException($"{label}过长或包含不支持的控制字符。");
        try { _ = Normalize(trimmed); }
        catch (ArgumentException) { throw new SummaryValidationException($"{label}包含无效 Unicode。"); }
        return trimmed;
    }
    internal static string Key(string text) => Normalize(text).Trim().ToUpperInvariant();
}

internal static class CatalogCodec
{
    internal const int MaxBytes = 16 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        MaxDepth = 16
    };
    internal static string Hash(byte[] data) => Convert.ToHexStringLower(SHA256.HashData(data));

    internal static byte[] Encode(CatalogDocument document)
    {
        Validate(document);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(document, Json);
        if (bytes.Length > MaxBytes) throw new SummaryValidationException("摘要库超过 16 MiB 限制。");
        return bytes;
    }

    internal static CatalogDocument Decode(byte[] bytes)
    {
        if (bytes.Length == 0 || bytes.Length > MaxBytes) throw new SummaryCorruptException("摘要文件为空或超过大小限制，未作任何修改。");
        try
        {
            using var parsed = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
            RejectDuplicateProperties(parsed.RootElement);
            var document = JsonSerializer.Deserialize<CatalogDocument>(bytes, Json) ?? throw new JsonException("null document");
            Validate(document);
            return document;
        }
        catch (Exception ex) when (ex is JsonException or SummaryValidationException or ArgumentException)
        { throw new SummaryCorruptException("摘要文件格式或内容损坏，未作任何修改；请检查备份。", ex); }
    }

    private static void RejectDuplicateProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name)) throw new JsonException("Duplicate JSON property.");
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var child in element.EnumerateArray()) RejectDuplicateProperties(child);
    }

    private static void Validate(CatalogDocument d)
    {
        if (d.SchemaVersion != 1 || d.BookId == Guid.Empty || d.CatalogId == Guid.Empty || d.Revision < 0 ||
            d.Categories is null || d.Entries is null || d.Categories.Count > 10000 || d.Entries.Count > 50000)
            throw new SummaryValidationException("摘要库版本、标识、修订号或数量无效。");
        var ids = new HashSet<Guid>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var category in d.Categories)
        {
            if (category is null || category.Id == Guid.Empty || !ids.Add(category.Id))
                throw new SummaryValidationException("摘要分类标识无效或重复。");
            if (category.Name != TextRules.Required(category.Name, "分类名称", 100) || !names.Add(TextRules.Key(category.Name)))
                throw new SummaryValidationException("摘要分类名称未规范化或重复。");
        }
        var entryIds = new HashSet<Guid>();
        var texts = new HashSet<(Guid, string)>();
        foreach (var entry in d.Entries)
        {
            if (entry is null || entry.Id == Guid.Empty || !entryIds.Add(entry.Id) || !ids.Contains(entry.CategoryId))
                throw new SummaryValidationException("摘要标识无效、重复或引用不存在的分类。");
            if (entry.Text != TextRules.Required(entry.Text, "摘要", 4000, true) || !texts.Add((entry.CategoryId, TextRules.Key(entry.Text))))
                throw new SummaryValidationException("同一分类内摘要重复或文字未规范化。");
        }
    }
}
