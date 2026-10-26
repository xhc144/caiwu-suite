using System.Data;
using System.Data.Common;

namespace Caiwu.LegacyCompatibility;

public sealed class LegacyExtractionException(string code) : Exception(code);

public interface ILegacyReadOnlyExtractor
{
    ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Explicit unavailable adapter. No connection strings, credentials, fallback engine, or original file
/// paths are accepted. A future provider must verify a second copy and version-specific read-only mode.
/// </summary>
public sealed class SqlAnywhereReadOnlyExtractor : ILegacyReadOnlyExtractor
{
    public ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        throw new LegacyExtractionException("sql_anywhere_driver_and_verified_copy_session_unavailable");
    }
}

/// <summary>
/// A real DbDataReader-to-snapshot boundary. Reader/session lifetime and schema enumeration belong
/// to the provider. This class never creates connections, issues SQL, starts engines, or writes files.
/// Caller supplies exact owner/name, declared types and nullability from the verified catalogue.
/// GetValue decoding is retained; original database byte encoding is not claimed to be validated.
/// </summary>
public static class RelationalReaderCapture
{
    public static async ValueTask<LegacyTable> CaptureAsync(DbDataReader reader, TableIdentity identity,
        IReadOnlyList<LegacyColumn> catalogueColumns, int maxRows = 1_000_000,
        CancellationToken cancellationToken = default)
    {
        if (maxRows < 1) throw new ArgumentOutOfRangeException(nameof(maxRows));
        var columns = catalogueColumns.ToArray();
        if (reader.FieldCount != columns.Length || columns.Where((c, i) => c.Name != reader.GetName(i)).Any())
            throw new LegacyExtractionException("reader_catalogue_column_order_mismatch");
        var rows = new List<LegacyRow>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (rows.Count == maxRows) throw new LegacyExtractionException("row_budget_exceeded_no_partial_snapshot");
            rows.Add(new LegacyRow(rows.Count + 1, Enumerable.Range(0, columns.Length)
                .Select(i => LegacyCell.Capture(reader.GetValue(i)))));
        }
        return new LegacyTable(identity, columns, rows);
    }
}

/// <summary>Test/fixture adapter only. It cannot label a DataSet as a verified original ledger.</summary>
public sealed class SyntheticDataSetExtractor : ILegacyReadOnlyExtractor
{
    private readonly LegacySnapshot snapshot;
    public SyntheticDataSetExtractor(DataSet data, string selectionId,
        IReadOnlyDictionary<TableIdentity, IReadOnlyList<LegacyColumn>> catalogue)
    {
        // Freeze now, so later fixture mutations cannot alter an in-progress preview.
        var tables = new List<LegacyTable>();
        foreach (DataTable table in data.Tables)
        {
            var identity = new TableIdentity(table.Namespace, table.TableName);
            if (!catalogue.TryGetValue(identity, out var columns) || table.Columns.Count != columns.Count
                || columns.Where((c, i) => c.Name != table.Columns[i].ColumnName).Any())
                throw new LegacyExtractionException("synthetic_catalogue_required_for_every_column");
            if (table.Rows.Cast<DataRow>().Any(r => r.RowState == DataRowState.Deleted))
                throw new LegacyExtractionException("fixture_contains_deleted_rows");
            tables.Add(new LegacyTable(identity, columns, table.Rows.Cast<DataRow>().Select((row, index) =>
                new LegacyRow(index + 1, row.ItemArray.Select(LegacyCell.Capture)))));
        }
        snapshot = new LegacySnapshot(selectionId, ExtractionOrigin.Synthetic, tables);
    }

    public ValueTask<LegacySnapshot> ExtractAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(snapshot);
    }
}
