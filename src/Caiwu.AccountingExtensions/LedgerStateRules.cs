using Caiwu.Contracts;
using System.Diagnostics.CodeAnalysis;
using System.Text;

namespace Caiwu.AccountingExtensions;

internal static class LedgerStateRules
{
    internal const decimal MaximumAmount = long.MaxValue / 100m;

    internal static void Require([DoesNotReturnIf(false)] bool condition, string message)
    {
        if (!condition) throw new LedgerValidationException(message);
    }

    internal static void Context(LedgerSnapshot state, LedgerMutationContext? context)
    {
        if (context is null || context.ExpectedBookId == Guid.Empty || context.ExpectedBookId != state.Book.Id ||
            context.ExpectedRevision < 0 || context.ExpectedRevision != state.Revision)
            throw new StoreConcurrencyException("账套或数据版本已变化；请保留输入并重新加载核对，不能直接刷新版本重试。");
    }

    internal static LedgerSnapshot Freeze(LedgerSnapshot state) => state with
    {
        Accounts = Array.AsReadOnly(state.Accounts.ToArray()),
        Vouchers = Array.AsReadOnly(state.Vouchers.Select(v => v with
        {
            Lines = Array.AsReadOnly(v.Lines.ToArray())
        }).ToArray()),
        AuditEvents = Array.AsReadOnly(state.AuditEvents.ToArray())
    };

    internal static LedgerSnapshot ValidateAndFreeze(LedgerSnapshot state)
    {
        ArgumentNullException.ThrowIfNull(state);
        Require(state.Book is not null && state.Book.Id != Guid.Empty && state.Revision >= 0,
            "账套标识或版本无效。");
        var book = state.Book!;
        Require(book.FiscalYear is >= 1 and <= 9999 && book.StartMonth is >= 1 and <= 12 &&
            book.ClosedThroughMonth >= book.StartMonth - 1 && book.ClosedThroughMonth <= 12, "账套会计期间无效。");
        Require(state.Accounts is not null && state.Vouchers is not null && state.AuditEvents is not null,
            "账套快照不完整。");
        Require(state.Vouchers.All(v => v is not null && v.Lines is not null), "凭证快照不完整。");
        var frozen = Freeze(state);
        Require(frozen.Accounts.All(a => a is not null && !string.IsNullOrWhiteSpace(a.Code)) &&
            frozen.Accounts.Select(a => a.Code).Distinct(StringComparer.Ordinal).Count() == frozen.Accounts.Count,
            "科目编码缺失或重复。");
        var accounts = frozen.Accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
        foreach (var a in accounts.Values)
        {
            MoneyPair(a.OpeningDebit, a.OpeningCredit, true);
            var seen = new HashSet<string>(StringComparer.Ordinal) { a.Code };
            for (var parent = a.ParentCode; parent is not null; parent = accounts[parent].ParentCode)
                Require(accounts.ContainsKey(parent) && seen.Add(parent), "科目层级缺失或循环。");
        }
        Require(frozen.Vouchers.Select(v => v.Id).Distinct().Count() == frozen.Vouchers.Count,
            "凭证标识重复。");
        Require(frozen.Vouchers.Select(v => (v.Date.Year, v.Date.Month, v.Kind, v.Number)).Distinct().Count() == frozen.Vouchers.Count,
            "凭证编号重复。");
        foreach (var v in frozen.Vouchers)
        {
            Require(v.Id != Guid.Empty && v.Date.Year == book.FiscalYear && v.Date.Month >= book.StartMonth &&
                Enum.IsDefined(v.Status) && v.Number > 0 && !string.IsNullOrWhiteSpace(v.Kind) &&
                !string.IsNullOrWhiteSpace(v.PreparedBy) && v.AttachmentCount >= 0 && v.Lines.Count >= 2,
                "凭证期间、标识、状态或内容无效。");
            if (v.Status != VoucherStatus.Draft)
                Require(!string.IsNullOrWhiteSpace(v.ReviewedBy) &&
                    !string.Equals(v.PreparedBy.Trim().Normalize(NormalizationForm.FormKC),
                        v.ReviewedBy.Trim().Normalize(NormalizationForm.FormKC), StringComparison.OrdinalIgnoreCase),
                    "凭证缺少独立审核人。");
            Require(v.Date.Month > book.ClosedThroughMonth || v.Status == VoucherStatus.Posted,
                "已结账期存在未过账凭证，不能执行逆操作。");
            foreach (var l in v.Lines)
            {
                Require(l is not null && accounts.ContainsKey(l.AccountCode) &&
                    !accounts.Values.Any(a => a.ParentCode == l.AccountCode), "凭证引用不存在或非末级科目。");
                MoneyPair(l!.Debit, l.Credit, false);
            }
            Require(v.Lines.Sum(l => l.Debit) == v.Lines.Sum(l => l.Credit), "凭证借贷不平。");
        }
        return frozen;
    }

    internal static void MoneyPair(decimal debit, decimal credit, bool allowZero)
    {
        Require(debit >= 0 && credit >= 0 && debit <= MaximumAmount && credit <= MaximumAmount &&
            decimal.Round(debit, 2) == debit && decimal.Round(credit, 2) == credit &&
            (debit == 0 || credit == 0) && (allowZero || debit != 0 || credit != 0), "金额超范围、精度无效或借贷方向冲突。");
    }

    internal static void Period(LedgerSnapshot state, int year, int month)
    {
        Require(year == state.Book.FiscalYear, "当前接口仅支持本账套会计年度；跨年处理需要扩展年度存储。");
        Require(month >= state.Book.StartMonth && month <= 12, "月份超出账套会计期间。");
    }

    internal static void RequireLegacyLedger(LedgerSnapshot state)
    {
        if (state.AuditEvents.Any(a => a.Action.StartsWith("ParityModuleCommit.", StringComparison.Ordinal)))
            throw new NotSupportedException("账套已包含共享模块状态；当前基础账务适配不能原子更新模块来源、辅助或派生状态，请使用共享会计逆操作/结转接口。");
    }
}
