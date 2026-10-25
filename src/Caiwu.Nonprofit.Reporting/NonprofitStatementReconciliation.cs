namespace Caiwu.Nonprofit.Reporting;

public sealed class NonprofitStatementSet
{
    public NonprofitStatement BalanceSheet { get; }
    public NonprofitStatement ActivityStatement { get; }
    public IReadOnlyList<MissingReason> Issues { get; }
    public bool HasCompleteReconciledCalculations => Issues.Count == 0;
    public bool CanIssueAsFormal => false;
    internal NonprofitStatementSet(NonprofitStatement balance, NonprofitStatement activity, IEnumerable<MissingReason> issues)
    { BalanceSheet = balance; ActivityStatement = activity; Issues = Array.AsReadOnly(issues.Distinct().ToArray()); }
    public void RequireCompleteReconciliation()
    {
        if (!HasCompleteReconciledCalculations) throw new InvalidOperationException("两表输入或净资产变动勾稽未完整通过：" + string.Join("；", Issues.Select(i => i.Code + ":" + i.Detail)));
    }
}

public static class NonprofitStatementReconciliation
{
    /// <summary>YTD changes, not current-month turnover, reconcile Jan1 to reporting end.
    /// Direct capital additions/other unsupported movements must be reported as SourceLimitations.</summary>
    public static NonprofitStatementSet Compare(NonprofitStatement balanceSheet, NonprofitStatement activityStatement)
    {
        ArgumentNullException.ThrowIfNull(balanceSheet); ArgumentNullException.ThrowIfNull(activityStatement);
        if (balanceSheet.OfficialForm != "会民非01表" || activityStatement.OfficialForm != "会民非02表")
            throw new ArgumentException("须按资产负债表、业务活动表顺序传入。");
        var b = balanceSheet.Context; var a = activityStatement.Context;
        if (b.BookId != a.BookId || b.SourceLedgerRevision != a.SourceLedgerRevision || b.SourceKind != a.SourceKind ||
            b.Period != a.Period || b.SourceEvidenceReference != a.SourceEvidenceReference)
            throw new ArgumentException("两表须来自同一账套、真实账簿版本、来源证据及报告期间；待审投影不能与真实账簿混合。");
        var issues = balanceSheet.MissingReasons.Concat(activityStatement.MissingReasons).ToList();
        var activity = activityStatement.Lines.Single(l => l.Key == "net-change");
        var offset = a.Period.Kind == ReportingPeriodKind.Annual ? 0 : 3;
        var keys = new[] { "net-assets.unrestricted", "net-assets.restricted", "net-assets.total" };
        for (var i = 0; i < keys.Length; i++)
        {
            var line = balanceSheet.Lines.Single(l => l.Key == keys[i]);
            var opening = line.Values[0].Amount; var closing = line.Values[1].Amount;
            var change = activity.Values[offset + i].Amount;
            if (opening.HasValue && closing.HasValue && change.HasValue && Money.Sum([closing.Value, -opening.Value]) != change.Value)
                issues.Add(new("NP_NET_ASSET_RECONCILIATION", keys[i], "期末减年初净资产不等于同类别本年累计净资产变动；需核查直接投入、前期调整、分类及结转，禁止倒挤差额。"));
        }
        return new(balanceSheet, activityStatement, issues);
    }
}
