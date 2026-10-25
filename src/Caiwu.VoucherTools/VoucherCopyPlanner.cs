using Caiwu.Contracts;

namespace Caiwu.VoucherTools;

/// <summary>
/// Pure snapshot preflight and whole-voucher copying. Has no store/service dependency,
/// performs no I/O, and never refreshes the original book/revision token.
/// Core remains the authority for validation and concurrency at the host's save boundary.
/// </summary>
public sealed class VoucherCopyPlanner : IVoucherCopyPlanner
{
    private const decimal MaximumAmount = long.MaxValue / 100m;

    public VoucherCopyResult Plan(LedgerSnapshot displayedSnapshot, Guid sourceVoucherId, VoucherCopyOptions options)
    {
        ArgumentNullException.ThrowIfNull(displayedSnapshot);
        ArgumentNullException.ThrowIfNull(options);
        var issues = new List<VoucherCopyIssue>();
        void Issue(VoucherCopyIssueCode code, string message, int? row = null) => issues.Add(new(code, message, row));
        var book = displayedSnapshot.Book;
        if (book is null || book.Id == Guid.Empty || displayedSnapshot.Revision < 0 ||
            book.FiscalYear is < 1 or > 9999 || book.StartMonth is < 1 or > 12 ||
            book.ClosedThroughMonth < book.StartMonth - 1 || book.ClosedThroughMonth > 12 ||
            displayedSnapshot.Accounts is null || displayedSnapshot.Vouchers is null ||
            displayedSnapshot.Accounts.Any(a => a is null || a.Code is null) ||
            displayedSnapshot.Accounts.GroupBy(a => a.Code, StringComparer.Ordinal).Any(g => g.Count() != 1))
        {
            Issue(VoucherCopyIssueCode.InvalidSnapshot, "显示的账套快照无效，请重新加载后重新选择源凭证。");
            return new(null, issues);
        }

        var matches = displayedSnapshot.Vouchers.Where(v => v is not null && v.Id == sourceVoucherId).ToArray();
        if (sourceVoucherId == Guid.Empty || matches.Length == 0)
        {
            Issue(VoucherCopyIssueCode.SourceNotFound, "源凭证不在当前显示的账套快照中，请重新选择。");
            return new(null, issues);
        }
        if (matches.Length != 1)
        {
            Issue(VoucherCopyIssueCode.AmbiguousSource, "显示的快照存在重复凭证身份，不能复制。");
            return new(null, issues);
        }
        var source = matches[0];
        if (!Enum.IsDefined(source.Status))
            Issue(VoucherCopyIssueCode.InvalidSourceStatus, "源凭证状态无效，不能复制。");

        if (options.Date.Year != book.FiscalYear || options.Date.Month < book.StartMonth)
            Issue(VoucherCopyIssueCode.DateOutsideBook, "新凭证日期超出账套会计年度或启用月份，请明确选择有效日期。");
        else if (options.Date.Month <= book.ClosedThroughMonth)
            Issue(VoucherCopyIssueCode.PeriodClosed, "新凭证日期所在期间已结账，请明确选择开放期间。");
        if (!ExactText(options.Kind))
            Issue(VoucherCopyIssueCode.InvalidKind, "请明确填写凭证字，不能留空、含控制字符或首尾空格。");
        if (options.Number <= 0)
            Issue(VoucherCopyIssueCode.InvalidNumber, "请明确填写正整数新编号，不自动沿用或分配编号。");
        else if (displayedSnapshot.Vouchers.Any(v => v is not null && v.Date.Year == options.Date.Year &&
            v.Date.Month == options.Date.Month && v.Kind == options.Kind && v.Number == options.Number))
            Issue(VoucherCopyIssueCode.NumberAlreadyUsed, "本年度、本月、该凭证字下的编号已存在，请明确选择其他编号。");
        if (options.AttachmentCount < 0)
            Issue(VoucherCopyIssueCode.InvalidAttachmentCount, "请明确填写非负附件张数。");
        if (!ExactText(options.PreparedBy))
            Issue(VoucherCopyIssueCode.InvalidPreparedBy, "请明确填写本次制单人，不能留空、含控制字符或首尾空格。");

        if (source.Lines is null || source.Lines.Count < 2)
        {
            Issue(VoucherCopyIssueCode.InvalidLines, "源凭证至少需要两条完整分录，不能自动补行。");
            return new(null, issues);
        }
        {
            var accounts = displayedSnapshot.Accounts.ToDictionary(a => a.Code, StringComparer.Ordinal);
            var parents = displayedSnapshot.Accounts.Where(a => a.ParentCode is not null)
                .Select(a => a.ParentCode!).ToHashSet(StringComparer.Ordinal);
            decimal debit = 0, credit = 0;
            var validAmounts = true;
            for (var index = 0; index < source.Lines.Count; index++)
            {
                var row = index + 1;
                var line = source.Lines[index];
                if (line is null)
                {
                    Issue(VoucherCopyIssueCode.InvalidLines, $"第 {row} 行分录为空，不能自动删除或补齐。", row);
                    validAmounts = false;
                    continue;
                }
                if (line.AccountCode is null || !accounts.TryGetValue(line.AccountCode, out var account))
                    Issue(VoucherCopyIssueCode.AccountMissing, $"第 {row} 行科目 {line.AccountCode} 不存在，请核对源凭证和科目。", row);
                else if (!account.IsActive)
                    Issue(VoucherCopyIssueCode.AccountInactive, $"第 {row} 行科目 {line.AccountCode} 已停用，不能自动替换科目。", row);
                else if (parents.Contains(account.Code))
                    Issue(VoucherCopyIssueCode.AccountNotLeaf, $"第 {row} 行科目 {line.AccountCode} 不是末级科目，不能自动选择下级。", row);
                if (!ExactText(line.Summary))
                    Issue(VoucherCopyIssueCode.InvalidSummary, $"第 {row} 行摘要无效；为保持原文，不自动修剪、补齐或替换。", row);
                if (!Money(line.Debit) || !Money(line.Credit) ||
                    line.Debit != 0 && line.Credit != 0 || line.Debit == 0 && line.Credit == 0)
                {
                    Issue(VoucherCopyIssueCode.InvalidAmount, $"第 {row} 行金额无效：须单边大于零、最多两位小数且在 Int64 分范围内；不舍入或跳过零行。", row);
                    validAmounts = false;
                }
                else
                {
                    debit += line.Debit;
                    credit += line.Credit;
                }
            }
            if (validAmounts && debit != credit)
                Issue(VoucherCopyIssueCode.Unbalanced, "源凭证借贷不平衡，不能自动配平或改变金额。");
        }

        if (issues.Count != 0) return new(null, issues);
        // Each row is detached, in the original order; identical rows remain separate rows.
        var lines = Array.AsReadOnly(source.Lines.Select(line => line with { }).ToArray());
        var draft = new VoucherDraft(null, options.Date, options.Kind, options.Number,
            options.AttachmentCount, lines, displayedSnapshot.Revision, book.Id);
        return new(new VoucherCopyPlan(source.Id, draft, options.PreparedBy), issues);
    }

    private static bool ExactText(string? value) => !string.IsNullOrWhiteSpace(value) &&
        value == value.Trim() && !value.Any(char.IsControl);

    private static bool Money(decimal value) => value >= 0 && value <= MaximumAmount && decimal.Round(value, 2) == value;
}
