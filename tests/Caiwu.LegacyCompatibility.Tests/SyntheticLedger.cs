using System.Data;
using Caiwu.LegacyCompatibility;

namespace Caiwu.LegacyCompatibility.Tests;

// Invented relational data only. Names, codes, dates, amounts and binary payload are synthetic.
internal sealed class SyntheticLedger
{
    public DataSet Data { get; } = new("invented_ledger");
    public Dictionary<TableIdentity, IReadOnlyList<LegacyColumn>> Catalogue { get; } = [];
    public const double Amount = 12.3456789012345;
    public const string Owner = "fixture_owner";

    public SyntheticLedger()
    {
        var accounts = Table("kmbm", ("kmbm", "varchar(30)", typeof(string)), ("km_mc", "varchar(80)", typeof(string)),
            ("kmjs", "smallint", typeof(short)), ("yefx", "char(1)", typeof(string)), ("sybz", "char(1)", typeof(string)),
            ("fbs", "char(1)", typeof(string)), ("sls", "char(1)", typeof(string)), ("xms", "char(1)", typeof(string)),
            ("dws", "char(1)", typeof(string)), ("bms", "char(1)", typeof(string)), ("grs", "char(1)", typeof(string)),
            ("wls", "char(1)", typeof(string)), ("xjs", "char(1)", typeof(string)), ("bz", "char(6)", typeof(string)),
            ("dw", "char(4)", typeof(string)), ("xmbm", "char(10)", typeof(string)), ("dwbm", "char(10)", typeof(string)),
            ("bmbm", "char(10)", typeof(string)), ("grbm", "char(10)", typeof(string)), ("unknown_flag", "char(3)", typeof(string)));
        Add(accounts, ("kmbm", "1001"), ("km_mc", "合成现金"), ("kmjs", (short)1), ("yefx", "D"), ("sybz", "?"),
            ("fbs", "F"), ("sls", "Q"), ("xms", "X"), ("dws", "C"), ("bms", "B"), ("grs", "G"),
            ("wls", "W"), ("xjs", "J"), ("bz", "CNY"), ("dw", "件  "), ("xmbm", "X01  "), ("unknown_flag", " ? "));
        Add(accounts, ("kmbm", "3001"), ("km_mc", "合成权益"), ("kmjs", (short)1), ("yefx", "C"), ("bz", "CNY"));

        var headers = Table("pzdj", ("nf", "integer", typeof(int)), ("yf", "integer", typeof(int)),
            ("pzlx", "smallint", typeof(short)), ("pzbh", "integer", typeof(int)), ("pzdj_fds", "integer", typeof(int)),
            ("pzdj_bz", "char(1)", typeof(string)), ("pzdj_zdr", "char(8)", typeof(string)),
            ("pzdj_shr", "char(8)", typeof(string)), ("pzdj_jzr", "char(8)", typeof(string)),
            ("pzdj_rq", "date", typeof(DateTime)), ("pzdj_shrq", "date", typeof(DateTime)), ("pzdj_jzrq", "date", typeof(DateTime)));
        Add(headers, ("nf", 2026), ("yf", 1), ("pzlx", (short)1), ("pzbh", 1), ("pzdj_fds", 2), ("pzdj_bz", "P"),
            ("pzdj_zdr", "MAKER01"), ("pzdj_shr", "CHECK02"), ("pzdj_jzr", "POST03"), ("pzdj_rq", new DateTime(2026, 1, 10)),
            ("pzdj_shrq", new DateTime(2026, 1, 11)), ("pzdj_jzrq", new DateTime(2026, 1, 12)));
        Add(headers, ("nf", 2026), ("yf", 1), ("pzlx", (short)1), ("pzbh", 2), ("pzdj_fds", 0), ("pzdj_bz", "D"),
            ("pzdj_zdr", "MAKER01"), ("pzdj_rq", new DateTime(2026, 1, 15)));

        var lines = Table("pz", ("nf", "integer", typeof(int)), ("yf", "integer", typeof(int)),
            ("pzlx", "smallint", typeof(short)), ("pzbh", "integer", typeof(int)), ("pz_xh", "integer", typeof(int)),
            ("kmbm", "char(20)", typeof(string)), ("pz_zy", "varchar(80)", typeof(string)),
            ("pz_jf", "double", typeof(double)), ("pz_df", "double", typeof(double)), ("pz_wb", "double", typeof(double)),
            ("pz_hl", "double", typeof(double)), ("pz_sl", "double", typeof(double)), ("pz_dj", "double", typeof(double)),
            ("jslb", "char(2)", typeof(string)), ("pz_ph", "char(20)", typeof(string)), ("jzbz", "char(1)", typeof(string)),
            ("xmbm", "char(10)", typeof(string)), ("dwbm", "char(10)", typeof(string)), ("bmbm", "char(10)", typeof(string)),
            ("grbm", "char(10)", typeof(string)), ("bz", "char(6)", typeof(string)), ("dw", "char(4)", typeof(string)),
            ("pzdj_bz", "char(1)", typeof(string)), ("dqrq", "date", typeof(DateTime)), ("dd", "integer", typeof(int)),
            ("xjbm", "char(4)", typeof(string)), ("htbh", "char(15)", typeof(string)), ("future_column", "numeric(30,20)", typeof(decimal)));
        Line(1, 1, "1001", Amount, 0);
        Line(1, 2, "3001", 0, Amount);
        Line(2, 1, "1001", 3.875, 0);
        Line(2, 2, "3001", 0, 3.875);

        var openings = Table("nc", ("nf", "integer", typeof(int)), ("kmbm", "char(20)", typeof(string)), ("bz", "char(6)", typeof(string)),
            ("nc_jf", "double", typeof(double)), ("nc_df", "double", typeof(double)), ("jq_jf", "double", typeof(double)),
            ("jq_df", "double", typeof(double)), ("nc_jf_b", "double", typeof(double)), ("nc_df_b", "double", typeof(double)),
            ("jq_jf_b", "double", typeof(double)), ("jq_df_b", "double", typeof(double)), ("fbs", "char(1)", typeof(string)));
        Add(openings, ("nf", 2026), ("kmbm", "1001"), ("bz", "CNY"), ("nc_jf", 100.125), ("nc_df", 0d),
            ("jq_jf", 5.5555), ("jq_df", 0d), ("nc_jf_b", 100.125), ("nc_df_b", 0d), ("jq_jf_b", 5.5555), ("jq_df_b", 0d), ("fbs", "?"));
        Add(openings, ("nf", 2026), ("kmbm", "3001"), ("bz", "CNY"), ("nc_jf", 0d), ("nc_df", 100.125),
            ("jq_jf", 0d), ("jq_df", 5.5555), ("nc_jf_b", 0d), ("nc_df_b", 100.125), ("jq_jf_b", 0d), ("jq_df_b", 5.5555));

        var movements = Table("hz", ("nf", "integer", typeof(int)), ("yf", "integer", typeof(int)), ("kmbm", "char(20)", typeof(string)),
            ("xmlb", "char(2)", typeof(string)), ("xmbm", "char(10)", typeof(string)), ("bz", "char(6)", typeof(string)),
            ("jf", "double", typeof(double)), ("df", "double", typeof(double)), ("wbjf", "double", typeof(double)), ("wbdf", "double", typeof(double)));
        Add(movements, ("nf", 2026), ("yf", 1), ("kmbm", "1001"), ("xmlb", ""), ("xmbm", ""), ("bz", "CNY"), ("jf", Amount), ("df", 0d), ("wbjf", 0d), ("wbdf", 0d));
        Add(movements, ("nf", 2026), ("yf", 1), ("kmbm", "3001"), ("xmlb", ""), ("xmbm", ""), ("bz", "CNY"), ("jf", 0d), ("df", Amount), ("wbjf", 0d), ("wbdf", 0d));

        var extra = Table("unmapped_module", ("id", "integer", typeof(int)), ("blob", "long binary", typeof(byte[])),
            ("empty", "varchar(80)", typeof(string)), ("null", "varchar(80)", typeof(string)),
            ("spaces", "char(4)", typeof(string)), ("amount", "numeric(18,4)", typeof(decimal)));
        Add(extra, ("id", 7), ("blob", new byte[] { 0, 255, 1, 128 }), ("empty", ""), ("spaces", "    "), ("amount", 100.2500m));

        void Line(int number, int sequence, string code, double debit, double credit) => Add(lines,
            ("nf", 2026), ("yf", 1), ("pzlx", (short)1), ("pzbh", number), ("pz_xh", sequence), ("kmbm", code),
            ("pz_zy", "合成摘要  "), ("pz_jf", debit), ("pz_df", credit), ("pz_wb", 1.23456789), ("pz_hl", 7.123456789),
            ("pz_sl", 0.123456789), ("pz_dj", 10.00000001), ("jslb", "A1"), ("pz_ph", "FAKE-CHECK"), ("jzbz", "?"),
            ("xmbm", "X01  "), ("dwbm", "C02"), ("bmbm", "B03"), ("grbm", "G04"), ("bz", "CNY"), ("dw", "件  "),
            ("pzdj_bz", "?"), ("dqrq", new DateTime(2026, 2, 2)), ("dd", 10), ("xjbm", "CF01"), ("htbh", "FAKE-CONTRACT"),
            ("future_column", 0.12345678901234567890m));
    }

    public DataTable this[string name] => Data.Tables[name]!;

    private DataTable Table(string name, params (string Name, string Declaration, Type Type)[] columns)
    {
        var table = new DataTable(name) { Namespace = Owner };
        foreach (var column in columns) table.Columns.Add(column.Name, column.Type);
        Data.Tables.Add(table);
        Catalogue.Add(new TableIdentity(Owner, name), columns.Select(c => new LegacyColumn(c.Name, c.Declaration, true)).ToArray());
        return table;
    }
    public static void Add(DataTable table, params (string Column, object Value)[] fields)
    {
        var row = table.NewRow();
        foreach (var (column, value) in fields) row[column] = value;
        table.Rows.Add(row);
    }
    public SyntheticDataSetExtractor Extractor() => new(Data, "synthetic-ledger-only", Catalogue);
    public async ValueTask<LegacySnapshot> Snapshot() => await Extractor().ExtractAsync(TestContext.Current.CancellationToken);
    public static CoreTableBinding[] Bindings(LegacySnapshot snapshot) => new[]
    {
        (CoreTable.Accounts, "kmbm"), (CoreTable.VoucherHeaders, "pzdj"), (CoreTable.VoucherLines, "pz"),
        (CoreTable.OpeningBalances, "nc"), (CoreTable.MonthlyMovements, "hz")
    }.Select(pair =>
    {
        var table = snapshot.Tables.Single(t => t.Identity.Name == pair.Item2);
        return new CoreTableBinding(pair.Item1, table.Identity, table.SchemaFingerprint);
    }).ToArray();

    public static PreviewInterpretation Interpretation(LegacySnapshot snapshot, bool knownStatuses = true,
        bool completeScope = true, OpeningAmountBasis openingBasis = OpeningAmountBasis.NativeBaseCurrencyRows,
        bool postedBasis = true, CharacterKeyPolicy keyPolicy = CharacterKeyPolicy.PreserveExact) =>
        new(Bindings(snapshot), 2026, 1, "CNY", ["1001", "3001"], knownStatuses ? ["P"] : [], knownStatuses ? ["D"] : [],
            "synthetic fixture rules; NOT original PB semantics", completeScope, openingBasis, postedBasis, "", "", keyPolicy);

    public static byte[] PreflightJson() => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Fixtures", "pr39-preflight.synthetic.json"));
    public static PreflightReceipt Receipt() => PreflightReceipt.Parse(PreflightJson(), "F004");
    public async ValueTask<PreviewOutcome> Run(Func<LegacySnapshot, PreviewInterpretation>? profile = null)
    {
        var extractor = Extractor();
        var snapshot = await extractor.ExtractAsync(TestContext.Current.CancellationToken);
        return await CompatibilityPreview.RunAsync(Receipt(), extractor, profile?.Invoke(snapshot) ?? Interpretation(snapshot), TestContext.Current.CancellationToken);
    }
}
