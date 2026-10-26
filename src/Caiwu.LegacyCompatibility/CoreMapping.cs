using System.Globalization;

namespace Caiwu.LegacyCompatibility;

public enum CoreTable { Accounts, VoucherHeaders, VoucherLines, OpeningBalances, MonthlyMovements }
public enum CharacterKeyPolicy { PreserveExact, TrimDeclaredCharPadding }
public sealed record CoreTableBinding(CoreTable Role, TableIdentity Identity, string SchemaFingerprint);
public sealed record SourceLocation(TableIdentity Table, int Row);
public readonly record struct VoucherKey(int Year, int Month, int Type, int Number);
public sealed record MappedAccount(string Code, string? Name, int? Level, string? RawBalanceDirection,
    string? RawDisabledFlag, IReadOnlyDictionary<string, string?> RawFeatureFlags,
    IReadOnlyDictionary<string, string?> DefaultDimensions, LegacyTable Table, LegacyRow Source);
public sealed record MappedHeader(VoucherKey Key, DateOnly Date, string? RawStatus,
    string? PreparedBy, string? ReviewedBy, string? PostedBy, int? AttachmentCount, DateOnly? ReviewDate,
    DateOnly? PostingDate, LegacyTable Table, LegacyRow Source);
public sealed record MappedLine(VoucherKey Key, int Sequence, string AccountCode, ExactNumber Debit,
    ExactNumber Credit, string? Currency, ExactNumber? ForeignAmount, ExactNumber? ExchangeRate,
    ExactNumber? Quantity, ExactNumber? UnitPrice, string? Summary, IReadOnlyDictionary<string, string?> Dimensions,
    string? SettlementType, string? BankDocumentNumber, DateOnly? DueDate, LegacyTable Table, LegacyRow Source);
public sealed record MappedOpening(int Year, string AccountCode, string? Currency,
    ExactNumber NativeDebit, ExactNumber NativeCredit, ExactNumber NativeBeforeDebit, ExactNumber NativeBeforeCredit,
    ExactNumber? BaseDebit, ExactNumber? BaseCredit, ExactNumber? BaseBeforeDebit, ExactNumber? BaseBeforeCredit,
    LegacyTable Table, LegacyRow Source);
public sealed record MappedMovement(int Year, int Month, string AccountCode, string? Currency,
    string? AuxiliaryKind, string? AuxiliaryCode, ExactNumber Debit, ExactNumber Credit,
    ExactNumber? ForeignDebit, ExactNumber? ForeignCredit, LegacyTable Table, LegacyRow Source);

public sealed class CoreProjection
{
    public LegacySnapshot Original { get; }
    public IReadOnlyList<MappedAccount> Accounts { get; }
    public IReadOnlyList<MappedHeader> Headers { get; }
    public IReadOnlyList<MappedLine> Lines { get; }
    public IReadOnlyList<MappedOpening> Openings { get; }
    public IReadOnlyList<MappedMovement> Movements { get; }

    internal CoreProjection(LegacySnapshot original, IEnumerable<MappedAccount> accounts,
        IEnumerable<MappedHeader> headers, IEnumerable<MappedLine> lines,
        IEnumerable<MappedOpening> openings, IEnumerable<MappedMovement> movements)
    {
        Original = original;
        Accounts = Array.AsReadOnly(accounts.ToArray());
        Headers = Array.AsReadOnly(headers.ToArray());
        Lines = Array.AsReadOnly(lines.ToArray());
        Openings = Array.AsReadOnly(openings.ToArray());
        Movements = Array.AsReadOnly(movements.ToArray());
    }
}

public sealed class LegacyMappingException : Exception
{
    public SourceLocation? Location { get; }
    internal LegacyMappingException(string code, SourceLocation? location = null) : base(code) { Location = location; }
}

public static class CoreMapper
{
    private static readonly IReadOnlyDictionary<CoreTable, string[]> RequiredColumns = new Dictionary<CoreTable, string[]>
    {
        [CoreTable.Accounts] = ["kmbm", "km_mc"],
        [CoreTable.VoucherHeaders] = ["nf", "yf", "pzlx", "pzbh", "pzdj_rq", "pzdj_bz", "pzdj_zdr", "pzdj_shr", "pzdj_jzr"],
        [CoreTable.VoucherLines] = ["nf", "yf", "pzlx", "pzbh", "pz_xh", "kmbm", "pz_jf", "pz_df"],
        [CoreTable.OpeningBalances] = ["nf", "kmbm", "bz", "nc_jf", "nc_df", "jq_jf", "jq_df"],
        [CoreTable.MonthlyMovements] = ["nf", "yf", "kmbm", "bz", "xmlb", "xmbm", "jf", "df"]
    };

    /// <summary>Bindings use exact owner/name + observed schema fingerprint, never template ID or guessed namespace.</summary>
    public static CoreProjection Map(LegacySnapshot snapshot, IEnumerable<CoreTableBinding> bindings,
        CharacterKeyPolicy keyPolicy = CharacterKeyPolicy.PreserveExact, CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(keyPolicy)) throw new LegacyMappingException("unknown_character_key_policy");
        var selected = bindings.ToArray();
        if (selected.Length != 5 || selected.Select(b => b.Role).Distinct().Count() != 5
            || selected.Select(b => b.Identity).Distinct().Count() != 5)
            throw new LegacyMappingException("five_distinct_explicit_core_bindings_required");
        var tables = new Dictionary<CoreTable, LegacyTable>();
        foreach (var binding in selected)
        {
            if (!RequiredColumns.ContainsKey(binding.Role)) throw new LegacyMappingException("unknown_core_role");
            var table = snapshot.Tables.SingleOrDefault(t => t.Identity == binding.Identity);
            if (table is null) throw new LegacyMappingException("bound_table_missing");
            if (table.SchemaFingerprint != binding.SchemaFingerprint) throw new LegacyMappingException("schema_fingerprint_mismatch");
            if (RequiredColumns[binding.Role].Any(c => !table.HasColumn(c)))
                throw new LegacyMappingException("core_required_columns_missing");
            tables.Add(binding.Role, table);
        }

        var accounts = Project(CoreTable.Accounts, r => new MappedAccount(r.Key("kmbm"), r.Text("km_mc"),
            r.OptionalInt("kmjs"), r.OptionalText("yefx"), r.OptionalText("sybz"),
            Fields(r, false, "kmsx", "zhlb", "fbs", "sls", "xms", "dws", "bms", "grs", "wls", "xjs", "yjd"),
            Fields(r, true, "bz", "dw", "xmbm", "dwbm", "bmbm", "grbm"), r.Table, r.Row));
        var headers = Project(CoreTable.VoucherHeaders, r => new MappedHeader(r.Voucher(), r.Date("pzdj_rq"),
            r.Text("pzdj_bz"), r.Text("pzdj_zdr"), r.Text("pzdj_shr"), r.Text("pzdj_jzr"),
            r.OptionalInt("pzdj_fds"), r.OptionalDate("pzdj_shrq"), r.OptionalDate("pzdj_jzrq"), r.Table, r.Row));
        var lines = Project(CoreTable.VoucherLines, r => new MappedLine(r.Voucher(), r.Int("pz_xh"), r.Key("kmbm"),
            r.Number("pz_jf"), r.Number("pz_df"), r.OptionalKey("bz"), r.OptionalNumber("pz_wb"),
            r.OptionalNumber("pz_hl"), r.OptionalNumber("pz_sl"), r.OptionalNumber("pz_dj"), r.OptionalText("pz_zy"),
            Fields(r, true, "xmbm", "dwbm", "bmbm", "grbm", "xjbm", "htbh", "dw"), r.OptionalKey("jslb"),
            r.OptionalKey("pz_ph"), r.OptionalDate("dqrq"), r.Table, r.Row));
        var openings = Project(CoreTable.OpeningBalances, r => new MappedOpening(r.Int("nf"), r.Key("kmbm"), r.OptionalKey("bz"),
            r.Number("nc_jf"), r.Number("nc_df"), r.Number("jq_jf"), r.Number("jq_df"), r.OptionalNumber("nc_jf_b"),
            r.OptionalNumber("nc_df_b"), r.OptionalNumber("jq_jf_b"), r.OptionalNumber("jq_df_b"), r.Table, r.Row));
        var movements = Project(CoreTable.MonthlyMovements, r => new MappedMovement(r.Int("nf"), r.Int("yf"), r.Key("kmbm"),
            r.OptionalKey("bz"), r.OptionalKey("xmlb"), r.OptionalKey("xmbm"), r.Number("jf"), r.Number("df"),
            r.OptionalNumber("wbjf"), r.OptionalNumber("wbdf"), r.Table, r.Row));
        return new CoreProjection(snapshot, accounts, headers, lines, openings, movements);

        IReadOnlyDictionary<string, string?> Fields(RowReader row, bool keys, params string[] names) =>
            new System.Collections.ObjectModel.ReadOnlyDictionary<string, string?>(names.Where(row.Table.HasColumn)
                .ToDictionary(name => name, name => keys ? row.OptionalKey(name) : row.Text(name), StringComparer.Ordinal));

        T[] Project<T>(CoreTable role, Func<RowReader, T> map) => tables[role].Rows.Select(row =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            return map(new RowReader(tables[role], row, keyPolicy));
        }).ToArray();
    }

    private sealed class RowReader(LegacyTable table, LegacyRow row, CharacterKeyPolicy keyPolicy)
    {
        public LegacyTable Table => table;
        public LegacyRow Row => row;
        private LegacyMappingException Invalid(string code) => new(code, new SourceLocation(table.Identity, row.Ordinal));
        public string? Text(string column)
        {
            var value = table.Cell(row, column);
            if (value.Storage == CellStorage.Null) return null;
            if (value.Storage != CellStorage.Text) throw Invalid("text_field_has_nontext_value");
            return value.Literal;
        }
        public string? OptionalText(string column) => table.HasColumn(column) ? Text(column) : null;
        public string Key(string column)
        {
            var key = OptionalKey(column);
            if (string.IsNullOrWhiteSpace(key)) throw Invalid("required_key_is_null_or_empty");
            return key;
        }
        public string? OptionalKey(string column)
        {
            if (!table.HasColumn(column)) return null;
            var text = Text(column);
            if (keyPolicy == CharacterKeyPolicy.TrimDeclaredCharPadding
                && table.Column(column).DeclaredType.StartsWith("char(", StringComparison.OrdinalIgnoreCase))
                return text?.TrimEnd(' ');
            return text;
        }
        public ExactNumber Number(string column)
        {
            var cell = table.Cell(row, column);
            if (cell.Storage is not (CellStorage.Integer or CellStorage.Decimal or CellStorage.FloatingPoint))
                throw Invalid("numeric_null_or_non_numeric_value_no_zero_substitution");
            try { return ExactNumber.Parse(cell.Literal!); }
            catch (Exception ex) when (ex is FormatException or OverflowException) { throw Invalid("unconvertible_numeric_literal"); }
        }
        public ExactNumber? OptionalNumber(string column) => !table.HasColumn(column)
            || table.Cell(row, column).Storage == CellStorage.Null ? null : Number(column);
        public int Int(string column)
        {
            var number = Number(column).ToString();
            if (!int.TryParse(number, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var value))
                throw Invalid("integer_field_out_of_range_or_fractional");
            return value;
        }
        public int? OptionalInt(string column) => !table.HasColumn(column)
            || table.Cell(row, column).Storage == CellStorage.Null ? null : Int(column);
        public DateOnly? OptionalDate(string column) => !table.HasColumn(column)
            || table.Cell(row, column).Storage == CellStorage.Null ? null : Date(column);
        public VoucherKey Voucher() => new(Int("nf"), Int("yf"), Int("pzlx"), Int("pzbh"));
        public DateOnly Date(string column)
        {
            var cell = table.Cell(row, column);
            if (cell.Storage == CellStorage.Date && DateOnly.TryParseExact(cell.Literal, "yyyy-MM-dd", CultureInfo.InvariantCulture,
                    DateTimeStyles.None, out var value)) return value;
            // A provider may expose SQL DATE as DateTime. Do not truncate a timestamp or adjust zones.
            if (cell.Storage == CellStorage.DateTime && DateTime.TryParseExact(cell.Literal, "O", CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind, out var date) && date.Kind == DateTimeKind.Unspecified && date.TimeOfDay == TimeSpan.Zero)
                return DateOnly.FromDateTime(date);
            throw Invalid("date_field_not_losslessly_representable_as_calendar_date");
        }
    }
}
