using System.Collections.ObjectModel;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Caiwu.LegacyCompatibility;

public enum ExtractionOrigin { Synthetic, ExternalCopyNotValidated }
public enum CellStorage { Null, Text, Integer, Decimal, FloatingPoint, Date, DateTime, Binary, Boolean, Guid }
public sealed record TableIdentity(string Owner, string Name);
public sealed record LegacyColumn(string Name, string DeclaredType, bool? Nullable);

/// <summary>Literal is lossless for the captured CLR value. Driver decoding/encoding remains a separate gate.</summary>
public sealed record LegacyCell(CellStorage Storage, string? Literal)
{
    public static LegacyCell Capture(object? value) => value switch
    {
        null or DBNull => new(CellStorage.Null, null),
        string text => new(CellStorage.Text, text),
        char character => new(CellStorage.Text, character.ToString()),
        byte or sbyte or short or ushort or int or uint or long or ulong =>
            new(CellStorage.Integer, Convert.ToString(value, CultureInfo.InvariantCulture)),
        decimal number => new(CellStorage.Decimal, number.ToString(CultureInfo.InvariantCulture)),
        double number when double.IsFinite(number) => new(CellStorage.FloatingPoint, number.ToString("R", CultureInfo.InvariantCulture)),
        float number when float.IsFinite(number) => new(CellStorage.FloatingPoint, number.ToString("R", CultureInfo.InvariantCulture)),
        DateOnly date => new(CellStorage.Date, date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
        DateTime date => new(CellStorage.DateTime, date.ToString("O", CultureInfo.InvariantCulture)),
        DateTimeOffset date => new(CellStorage.DateTime, date.ToString("O", CultureInfo.InvariantCulture)),
        byte[] bytes => new(CellStorage.Binary, Convert.ToBase64String(bytes)),
        bool boolean => new(CellStorage.Boolean, boolean ? "true" : "false"),
        Guid guid => new(CellStorage.Guid, guid.ToString("D")),
        _ => throw new LegacyExtractionException("unsupported_provider_value_no_partial_snapshot")
    };
}

public sealed class LegacyRow
{
    public int Ordinal { get; }
    public IReadOnlyList<LegacyCell> Cells { get; }
    public LegacyRow(int ordinal, IEnumerable<LegacyCell> cells)
    {
        if (ordinal < 1) throw new ArgumentOutOfRangeException(nameof(ordinal));
        Ordinal = ordinal;
        Cells = Array.AsReadOnly(cells.ToArray());
        if (Cells.Any(c => c is null || !Enum.IsDefined(c.Storage) || (c.Storage == CellStorage.Null) != (c.Literal is null)))
            throw new ArgumentException("invalid_cell");
    }
}

public sealed class LegacyTable
{
    public TableIdentity Identity { get; }
    public IReadOnlyList<LegacyColumn> Columns { get; }
    public IReadOnlyList<LegacyRow> Rows { get; }
    public string SchemaFingerprint { get; }
    private readonly IReadOnlyDictionary<string, int> columnIndexes;

    public LegacyTable(TableIdentity identity, IEnumerable<LegacyColumn> columns, IEnumerable<LegacyRow> rows)
    {
        Identity = identity;
        if (string.IsNullOrWhiteSpace(identity.Name)) throw new ArgumentException("table_name_required");
        Columns = Array.AsReadOnly(columns.ToArray());
        Rows = Array.AsReadOnly(rows.ToArray());
        if (Columns.Count == 0 || Columns.Any(c => string.IsNullOrWhiteSpace(c.Name) || string.IsNullOrWhiteSpace(c.DeclaredType))
            || Columns.Select(c => c.Name).Distinct(StringComparer.Ordinal).Count() != Columns.Count)
            throw new ArgumentException("unique_named_columns_with_declarations_required");
        if (Rows.Any(r => r.Cells.Count != Columns.Count)
            || Rows.Select(r => r.Ordinal).Distinct().Count() != Rows.Count)
            throw new ArgumentException("invalid_row_shape_or_ordinal");
        columnIndexes = new ReadOnlyDictionary<string, int>(Columns.Select((c, i) => (c.Name, i))
            .ToDictionary(x => x.Name, x => x.i, StringComparer.Ordinal));
        SchemaFingerprint = Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
            new { identity.Owner, identity.Name, Columns })));
    }

    public bool HasColumn(string name) => columnIndexes.ContainsKey(name);
    public LegacyCell Cell(LegacyRow row, string name) => row.Cells[columnIndexes[name]];
    public LegacyColumn Column(string name) => Columns[columnIndexes[name]];
}

/// <summary>All captured tables/fields survive the core projection, including unrecognised module data.</summary>
public sealed class LegacySnapshot
{
    public string SelectionId { get; }
    public ExtractionOrigin Origin { get; }
    public IReadOnlyList<LegacyTable> Tables { get; }
    public string ContentFingerprint { get; }

    public LegacySnapshot(string selectionId, ExtractionOrigin origin, IEnumerable<LegacyTable> tables)
    {
        if (string.IsNullOrWhiteSpace(selectionId) || !Enum.IsDefined(origin)) throw new ArgumentException("explicit_selection_and_origin_required");
        SelectionId = selectionId;
        Origin = origin;
        Tables = Array.AsReadOnly(tables.ToArray());
        if (Tables.Select(t => t.Identity).Distinct().Count() != Tables.Count)
            throw new ArgumentException("duplicate_table_identity");
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        // Length-delimited JSON components preserve row/column order, NULL and trailing spaces.
        foreach (var table in Tables)
        {
            Append(table.SchemaFingerprint);
            foreach (var row in table.Rows) Append(row);
        }
        ContentFingerprint = Convert.ToHexStringLower(hash.GetHashAndReset());
        void Append<T>(T value)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
            hash.AppendData(Encoding.ASCII.GetBytes(bytes.Length.ToString(CultureInfo.InvariantCulture) + ":"));
            hash.AppendData(bytes);
        }
    }
}
