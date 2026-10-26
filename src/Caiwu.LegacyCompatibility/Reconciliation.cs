namespace Caiwu.LegacyCompatibility;

public enum OpeningAmountBasis { NotConfirmed, NativeBaseCurrencyRows, ConvertedBaseColumns }
public enum CheckStatus { Matched, Mismatch, NotAssessed, Information }
public sealed record ReconciliationCheck(string Code, CheckStatus Status, SourceLocation? Source = null,
    string? Left = null, string? Right = null);

/// <summary>
/// Caller-declared interpretation for one period. No built-in original status-code, currency,
/// leaf-account, CHAR-padding, or auxiliary aggregation assumptions. Schema binding is mandatory.
/// Evidence is a review reference, not an authenticated original-runtime approval.
/// </summary>
public sealed class PreviewInterpretation
{
    public IReadOnlyList<CoreTableBinding> Bindings { get; }
    public CharacterKeyPolicy KeyPolicy { get; }
    public int Year { get; }
    public int Month { get; }
    public string BaseCurrency { get; }
    public IReadOnlySet<string> AccountScope { get; }
    public bool CompleteLeafScopeDeclared { get; }
    public OpeningAmountBasis OpeningBasis { get; }
    public string? BaseAuxiliaryKind { get; }
    public string? BaseAuxiliaryCode { get; }
    public bool PostedOnlyMovementBasisDeclared { get; }
    public IReadOnlySet<string> PostedStatusCodes { get; }
    public IReadOnlySet<string> UnpostedStatusCodes { get; }
    public string EvidenceReference { get; }

    public PreviewInterpretation(IEnumerable<CoreTableBinding> bindings, int year, int month, string baseCurrency,
        IEnumerable<string> accountScope, IEnumerable<string> postedStatusCodes, IEnumerable<string> unpostedStatusCodes,
        string evidenceReference, bool completeLeafScopeDeclared = false,
        OpeningAmountBasis openingBasis = OpeningAmountBasis.NotConfirmed,
        bool postedOnlyMovementBasisDeclared = false, string? baseAuxiliaryKind = null,
        string? baseAuxiliaryCode = null, CharacterKeyPolicy keyPolicy = CharacterKeyPolicy.PreserveExact)
    {
        if (year is < 1 or > 9999 || month is < 1 or > 12 || string.IsNullOrWhiteSpace(baseCurrency)
            || string.IsNullOrWhiteSpace(evidenceReference) || !Enum.IsDefined(openingBasis) || !Enum.IsDefined(keyPolicy))
            throw new ArgumentException("explicit_valid_preview_scope_and_evidence_required");
        Bindings = Array.AsReadOnly(bindings.ToArray());
        Year = year; Month = month; BaseCurrency = baseCurrency; EvidenceReference = evidenceReference;
        AccountScope = accountScope.ToFrozenSet(StringComparer.Ordinal);
        PostedStatusCodes = postedStatusCodes.ToFrozenSet(StringComparer.Ordinal);
        UnpostedStatusCodes = unpostedStatusCodes.ToFrozenSet(StringComparer.Ordinal);
        if (AccountScope.Count == 0 || AccountScope.Any(string.IsNullOrWhiteSpace)
            || PostedStatusCodes.Any(c => c is null) || UnpostedStatusCodes.Any(c => c is null)
            || PostedStatusCodes.Overlaps(UnpostedStatusCodes)) throw new ArgumentException("ambiguous_or_empty_preview_scope");
        CompleteLeafScopeDeclared = completeLeafScopeDeclared;
        OpeningBasis = openingBasis;
        PostedOnlyMovementBasisDeclared = postedOnlyMovementBasisDeclared;
        BaseAuxiliaryKind = baseAuxiliaryKind;
        BaseAuxiliaryCode = baseAuxiliaryCode;
        KeyPolicy = keyPolicy;
    }
}

public static class CoreReconciler
{
    public static IReadOnlyList<ReconciliationCheck> Reconcile(CoreProjection data, PreviewInterpretation profile,
        CancellationToken cancellationToken = default)
    {
        var checks = new List<ReconciliationCheck>();
        var accounts = data.Accounts.GroupBy(a => a.Code, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.ToArray());
        var headers = data.Headers.GroupBy(h => h.Key).ToDictionary(g => g.Key, g => g.ToArray());
        var linesByVoucher = data.Lines.ToLookup(l => l.Key);
        foreach (var group in accounts.Values.Where(g => g.Length > 1))
            Add("account_key_collision_no_deduplication", CheckStatus.Mismatch, group[1].Table, group[1].Source);
        foreach (var group in headers.Values.Where(g => g.Length > 1))
            Add("voucher_header_key_collision", CheckStatus.Mismatch, group[1].Table, group[1].Source);
        foreach (var group in data.Lines.GroupBy(l => (l.Key, l.Sequence)).Where(g => g.Count() > 1))
        {
            var line = group.Skip(1).First();
            Add("voucher_line_key_collision_no_renumbering", CheckStatus.Mismatch, line.Table, line.Source);
        }
        foreach (var header in data.Headers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (header.Date.Year != header.Key.Year || header.Date.Month != header.Key.Month)
                Add("voucher_date_period_mismatch", CheckStatus.Mismatch, header.Table, header.Source);
            var lines = linesByVoucher[header.Key].ToArray();
            if (lines.Length == 0) Add("voucher_header_without_lines", CheckStatus.Mismatch, header.Table, header.Source);
            else Compare("voucher_debit_credit", Sum(lines.Select(l => l.Debit)), Sum(lines.Select(l => l.Credit)), header.Table, header.Source);
        }
        foreach (var line in data.Lines)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!headers.ContainsKey(line.Key)) Add("orphan_voucher_line", CheckStatus.Mismatch, line.Table, line.Source);
            RequireAccount(line.AccountCode, line.Table, line.Source);
        }
        foreach (var row in data.Openings) RequireAccount(row.AccountCode, row.Table, row.Source);
        foreach (var row in data.Movements) RequireAccount(row.AccountCode, row.Table, row.Source);
        foreach (var group in data.Openings.GroupBy(r => (r.Year, r.AccountCode, r.Currency)).Where(g => g.Count() > 1))
        {
            var row = group.Skip(1).First();
            Add("opening_grain_collision_no_aggregation", CheckStatus.Mismatch, row.Table, row.Source);
        }
        foreach (var group in data.Movements.GroupBy(r => (r.Year, r.Month, r.AccountCode, r.Currency, r.AuxiliaryKind, r.AuxiliaryCode)).Where(g => g.Count() > 1))
        {
            var row = group.Skip(1).First();
            Add("movement_grain_collision_no_aggregation", CheckStatus.Mismatch, row.Table, row.Source);
        }
        if (data.Openings.Any(r => r.Year is < 1 or > 9999)
            || data.Movements.Any(r => r.Year is < 1 or > 9999 || r.Month is < 1 or > 12))
            checks.Add(new("balance_period_invalid", CheckStatus.Mismatch));
        foreach (var code in profile.AccountScope)
            if (!accounts.ContainsKey(code)) checks.Add(new("declared_scope_account_missing", CheckStatus.Mismatch));

        if (!profile.CompleteLeafScopeDeclared) checks.Add(new("complete_leaf_scope_not_declared", CheckStatus.NotAssessed));
        if (profile.OpeningBasis == OpeningAmountBasis.NotConfirmed) checks.Add(new("opening_amount_basis_unknown", CheckStatus.NotAssessed));
        var selectedOpenings = data.Openings.Where(o => o.Year == profile.Year && o.Currency == profile.BaseCurrency
            && profile.AccountScope.Contains(o.AccountCode)).ToLookup(o => o.AccountCode, StringComparer.Ordinal);
        var usableOpenings = new List<(ExactNumber Debit, ExactNumber Credit, ExactNumber BeforeDebit, ExactNumber BeforeCredit)>();
        foreach (var code in profile.AccountScope)
        {
            var rows = selectedOpenings[code].ToArray();
            if (rows.Length != 1) { checks.Add(new("opening_row_missing_or_ambiguous_no_zero_substitution", CheckStatus.NotAssessed)); continue; }
            var row = rows[0];
            if (profile.OpeningBasis == OpeningAmountBasis.NativeBaseCurrencyRows)
                usableOpenings.Add((row.NativeDebit, row.NativeCredit, row.NativeBeforeDebit, row.NativeBeforeCredit));
            else if (profile.OpeningBasis == OpeningAmountBasis.ConvertedBaseColumns)
            {
                if (row.BaseDebit is null || row.BaseCredit is null || row.BaseBeforeDebit is null || row.BaseBeforeCredit is null)
                    Add("base_opening_columns_missing_or_null", CheckStatus.NotAssessed, row.Table, row.Source);
                else usableOpenings.Add((row.BaseDebit.Value, row.BaseCredit.Value, row.BaseBeforeDebit.Value, row.BaseBeforeCredit.Value));
            }
        }
        if (profile.CompleteLeafScopeDeclared && usableOpenings.Count == profile.AccountScope.Count)
        {
            Compare("opening_trial_balance", Sum(usableOpenings.Select(o => o.Debit)), Sum(usableOpenings.Select(o => o.Credit)));
            Compare("before_opening_trial_balance", Sum(usableOpenings.Select(o => o.BeforeDebit)), Sum(usableOpenings.Select(o => o.BeforeCredit)));
        }

        var scopedHeaders = data.Headers.Where(h => h.Key.Year == profile.Year && h.Key.Month == profile.Month).ToArray();
        var postedKeys = new HashSet<VoucherKey>();
        var statusComplete = true;
        foreach (var header in scopedHeaders)
        {
            if (header.RawStatus is not null && profile.PostedStatusCodes.Contains(header.RawStatus)) postedKeys.Add(header.Key);
            else if (header.RawStatus is null || !profile.UnpostedStatusCodes.Contains(header.RawStatus))
            {
                statusComplete = false;
                Add("posting_status_not_interpreted_no_guess", CheckStatus.NotAssessed, header.Table, header.Source);
            }
        }
        if (!profile.PostedOnlyMovementBasisDeclared) checks.Add(new("movement_posted_only_basis_unknown", CheckStatus.NotAssessed));
        var movements = data.Movements.Where(r => r.Year == profile.Year && r.Month == profile.Month
            && r.Currency == profile.BaseCurrency && r.AuxiliaryKind == profile.BaseAuxiliaryKind
            && r.AuxiliaryCode == profile.BaseAuxiliaryCode && profile.AccountScope.Contains(r.AccountCode))
            .ToLookup(r => r.AccountCode, StringComparer.Ordinal);
        var postedLinesByAccount = data.Lines.Where(l => postedKeys.Contains(l.Key)).ToLookup(l => l.AccountCode, StringComparer.Ordinal);
        if (statusComplete && profile.PostedOnlyMovementBasisDeclared)
        {
            foreach (var code in profile.AccountScope)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var rows = movements[code].ToArray();
                if (rows.Length != 1) { checks.Add(new("movement_row_missing_or_ambiguous_no_zero_substitution", CheckStatus.NotAssessed)); continue; }
                var movement = rows[0];
                var lines = postedLinesByAccount[code].ToArray();
                Compare("monthly_posted_debit", Sum(lines.Select(l => l.Debit)), movement.Debit, movement.Table, movement.Source);
                Compare("monthly_posted_credit", Sum(lines.Select(l => l.Credit)), movement.Credit, movement.Table, movement.Source);
            }
        }
        checks.Add(new("original_status_and_scope_rules_operator_declared_only", CheckStatus.Information));
        checks.Add(new("foreign_quantity_auxiliary_modules_preserved_not_reconciled", CheckStatus.Information));
        if (data.Original.Tables.SelectMany(t => t.Rows).SelectMany(r => r.Cells).Any(c => c.Storage == CellStorage.FloatingPoint))
            checks.Add(new("roundtrip_decimal_arithmetic_not_original_binary_evaluation", CheckStatus.Information));
        return Array.AsReadOnly(checks.ToArray());

        void RequireAccount(string code, LegacyTable table, LegacyRow row)
        {
            if (!accounts.ContainsKey(code)) Add("referenced_account_missing", CheckStatus.Mismatch, table, row);
        }
        void Add(string code, CheckStatus status, LegacyTable table, LegacyRow row) =>
            checks.Add(new(code, status, new SourceLocation(table.Identity, row.Ordinal)));
        void Compare(string code, ExactNumber left, ExactNumber right, LegacyTable? table = null, LegacyRow? row = null) =>
            checks.Add(new(code, left == right ? CheckStatus.Matched : CheckStatus.Mismatch,
                table is null || row is null ? null : new SourceLocation(table.Identity, row.Ordinal), left.ToString(), right.ToString()));
    }

    private static ExactNumber Sum(IEnumerable<ExactNumber> numbers) => numbers.Aggregate(ExactNumber.Zero, (a, b) => a + b);
}
