using System.Security.Cryptography;
using System.Text;
using static Caiwu.Nonprofit.NonprofitRules;
using static Caiwu.Nonprofit.Writable.NonprofitLedgerValidation;

namespace Caiwu.Nonprofit.Writable;

public sealed partial class NonprofitLedgerService
{
    /// <summary>Generate a real saved DRAFT from posted balances, retaining restriction/project scopes.
    /// The result still requires a different reviewer and ordinary posting. Negative income/expenses are supported.</summary>
    public NonprofitLedgerVoucher GenerateClosingDraft(int month, string voucherKind, Guid requestId,
        IReadOnlyDictionary<RestrictionClass, string> netAssetAccounts,
        NonprofitMutationContext context, string actor)
    {
        var s = Begin(context, actor, NonprofitPermission.Close); OpenMonth(s, month);
        Check(requestId != Guid.Empty && !s.Vouchers.Any(v => v.SourceProposalId == requestId),
            "NP_DUPLICATE_REQUEST", "结转请求ID无效或已经生成凭证，请勿重复提交。");
        Check(s.OpeningConfirmed && s.Vouchers.Where(v => v.Date.Month <= month).All(v => v.State == NonprofitVoucherState.Posted),
            "NP_UNPOSTED", "截止本月还有未过账凭证或期初尚未确认，不能自动结转。");
        var end = new DateOnly(s.FiscalYear, month, DateTime.DaysInMonth(s.FiscalYear, month));
        var source = s.Opening.Select(o => (o.AccountCode, o.Classification, o.Dimensions, ComponentId: (string?)null, Net: o.Debit - o.Credit))
            .Concat(s.Vouchers.Where(v => v.State == NonprofitVoucherState.Posted && v.Date <= end).SelectMany(v => v.Lines)
                .Select(l => (l.AccountCode, l.Classification, l.Dimensions, l.ComponentId, Net: l.Debit - l.Credit)))
            .Where(x => ProfitLoss(Leaf(s, x.AccountCode)))
            .GroupBy(x => (x.AccountCode, x.Classification, x.Dimensions, x.ComponentId))
            .Select(g => (g.Key.AccountCode, g.Key.Classification, g.Key.Dimensions, g.Key.ComponentId, Net: Sum(g.Select(x => x.Net))))
            .Where(x => x.Net != 0).OrderBy(x => x.AccountCode, StringComparer.Ordinal)
            .ThenBy(x => x.Classification?.RestrictionId, StringComparer.Ordinal).ToArray();
        Check(source.Length > 0, "NP_NOTHING_TO_CLOSE", "损益余额已经结清，没有可生成的结转金额。");
        var lines = new List<NonprofitLedgerLine>();
        Guid Id(string scope) => new(SHA256.HashData(Encoding.UTF8.GetBytes($"{s.BookId:D}|{requestId:D}|{scope}")).AsSpan(0, 16));
        foreach (var row in source)
        {
            var a = Leaf(s, row.AccountCode);
            Check(a.OfficialRoot != "5601", "NP_MANUAL_TAX_REVIEW", "所得税费用自动结转需单独审定处理，本切片不自动生成。");
            Check(!a.Dimensions.ForeignCurrency && !a.Dimensions.Quantity && row.Dimensions.ForeignAmount is null && row.Dimensions.Quantity is null,
                "NP_CLOSING_DIMENSIONS_UNIMPLEMENTED", "复币/数量损益结转的原币及数量方向未有充分原版证据；请保留明细并使用人工经审结转。");
            lines.Add(new(Id("pl:" + lines.Count), row.AccountCode, "月度损益结转", Math.Max(-row.Net, 0), Math.Max(row.Net, 0),
                row.Classification, row.ComponentId, row.Dimensions, []));
        }
        foreach (var group in source.GroupBy(x => x.Classification))
        {
            var total = Sum(group.Select(x => x.Net)); if (total == 0) continue;
            Check(group.Key is not null && netAssetAccounts.TryGetValue(group.Key.Class, out _), "NP_CLOSING_ACCOUNT", "请明确指定两类净资产对应末级科目。");
            var code = netAssetAccounts[group.Key!.Class]; var account = Leaf(s, code);
            Check(account.OfficialRoot == (group.Key.Class == RestrictionClass.Unrestricted ? "3101" : "3102"),
                "NP_CLOSING_ACCOUNT", "结转净资产科目与限定类别不符。");
            lines.Add(new(Id("net:" + lines.Count), code, "月度损益结转", Math.Max(total, 0), Math.Max(-total, 0),
                group.Key, null, new(Project: group.Key.ProjectId), []));
        }
        var draft = new NonprofitVoucherDraft(null, end, voucherKind, null, 0,
            NonprofitMovementRole.IncomeExpenseClosing, $"closing:{s.BookId:D};revision:{s.Revision};month:{month};request:{requestId:D}", lines, [], requestId);
        return SaveDraft(draft, context, actor);
    }
}
