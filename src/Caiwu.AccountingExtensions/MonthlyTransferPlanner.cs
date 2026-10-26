using Caiwu.Contracts;
using static Caiwu.AccountingExtensions.LedgerStateRules;

namespace Caiwu.AccountingExtensions;

/// <summary>Explicit full-balance transfer only; no guesses about account prefixes, original ratio/type codes or templates.</summary>
public static class MonthlyTransferPlanner
{
    public static MonthlyTransferPlan CreatePlan(LedgerSnapshot snapshot, MonthlyTransferRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var state = ValidateAndFreeze(snapshot);
        Context(state, request.Context);
        Period(state, request.FiscalYear, request.Month);
        Require(request.Month > state.Book.ClosedThroughMonth, "已经结账，不能月度结转；请先反结账。");
        var end = new DateOnly(request.FiscalYear, request.Month, DateTime.DaysInMonth(request.FiscalYear, request.Month));
        Require(!state.Vouchers.Any(v => v.Date <= end && v.Status != VoucherStatus.Posted),
            "本月或前期还有未过账凭证，不能自动结转。");
        var definition = request.Definition;
        Require(definition is not null && !string.IsNullOrWhiteSpace(definition.Code) &&
            !string.IsNullOrWhiteSpace(definition.Version) && !string.IsNullOrWhiteSpace(definition.Summary) &&
            !string.IsNullOrWhiteSpace(definition.VoucherKind) && definition.SourceAccountCodes is not null,
            "请提供完整的全额结转设置及版本。");
        var sources = definition!.SourceAccountCodes.ToArray();
        Require(sources.Length > 0 && sources.All(s => !string.IsNullOrWhiteSpace(s)) &&
            sources.Distinct(StringComparer.Ordinal).Count() == sources.Length, "转出科目不能为空或重复。");
        Require(!sources.Contains(definition.DestinationAccountCode, StringComparer.Ordinal), "转入与转出科目不能相同。");
        var accounts = state.Accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        foreach (var code in sources.Append(definition.DestinationAccountCode))
            Require(code is not null && accounts.TryGetValue(code, out var account) && account.IsActive &&
                !state.Accounts.Any(a => a.ParentCode == code), "结转只能使用已启用的末级科目。");
        // A later voucher may already have transferred this period's balance. Ignoring it while
        // generating an earlier transfer can count the same income twice. Without an atomic
        // invalidation/recalculation protocol, even a reviewed/draft later voucher remains a
        // dependency that could be reposted. Do not infer transfer identity from Kind or Summary.
        var affectedAccounts = sources.Append(definition.DestinationAccountCode).ToHashSet(StringComparer.Ordinal);
        Require(!state.Vouchers.Any(v => v.Date > end && v.Lines.Any(l => affectedAccounts.Contains(l.AccountCode))),
            "所选结转科目已有后期凭证，不能倒序结转；请先按权限撤销并移除后期相关凭证，再按月重新计算。不得保留旧后期结转后重复生成。");
        Require(state.Accounts.Sum(a => a.OpeningDebit) == state.Accounts.Sum(a => a.OpeningCredit),
            "年初数不平，不能自动结转。");
        var balances = sources.ToDictionary(code => code,
            code => accounts[code].OpeningDebit - accounts[code].OpeningCredit, StringComparer.Ordinal);
        foreach (var v in state.Vouchers.Where(v => v.Date <= end && v.Status == VoucherStatus.Posted))
        foreach (var line in v.Lines)
            if (balances.ContainsKey(line.AccountCode))
                balances[line.AccountCode] = checked(balances[line.AccountCode] + line.Debit - line.Credit);

        var lines = new List<VoucherLine>();
        foreach (var code in sources)
        {
            var amount = balances[code];
            if (amount == 0) continue;
            var line = new VoucherLine(code, definition.Summary, Math.Max(-amount, 0), Math.Max(amount, 0));
            MoneyPair(line.Debit, line.Credit, false);
            lines.Add(line);
        }
        Require(lines.Count != 0, "所选科目没有待结转余额；未生成空凭证。");
        var total = balances.Values.Sum();
        if (total != 0)
        {
            var target = new VoucherLine(definition.DestinationAccountCode, definition.Summary,
                Math.Max(total, 0), Math.Max(-total, 0));
            MoneyPair(target.Debit, target.Credit, false);
            lines.Add(target);
        }
        Require(lines.Count >= 2 && lines.Sum(l => l.Debit) == lines.Sum(l => l.Credit), "结转凭证借贷不平。");
        var frozenDefinition = definition with { SourceAccountCodes = Array.AsReadOnly(sources) };
        return new MonthlyTransferPlan(request.Context, end, frozenDefinition, lines.AsReadOnly());
    }
}
