using System.Globalization;
using Caiwu.Contracts;

namespace Caiwu.VoucherTools.Wpf;

internal enum CopyField { General, Date, Kind, Number, Attachments, PreparedBy }
internal sealed record CopyFormInput(string Date, string Kind, string Number, string Attachments);
internal sealed record CopyFormError(CopyField Field, string Message);
internal sealed record CopyFormFeedback(VoucherCopyPlan? Plan, IReadOnlyList<CopyFormError> Errors);

/// <summary>UI parsing only. A linked net10.0 test project executes this exact production source.</summary>
internal static class CopyForm
{
    internal static CopyFormFeedback Validate(LedgerSnapshot shown, Guid sourceId, string currentPreparedBy,
        CopyFormInput input, IVoucherCopyPlanner planner)
    {
        var errors = new List<CopyFormError>();
        if (!DateOnly.TryParseExact(input.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var date))
            errors.Add(new(CopyField.Date, "请填写完整日期，格式为 yyyy-MM-dd。"));
        if (!ExactText(input.Kind))
            errors.Add(new(CopyField.Kind, "请填写凭证类型，不能含首尾空格或控制字符。"));
        if (!int.TryParse(input.Number, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number <= 0)
            errors.Add(new(CopyField.Number, "请输入 1 至 2147483647 的整数编号。"));
        if (!int.TryParse(input.Attachments, NumberStyles.None, CultureInfo.InvariantCulture, out var attachments))
            errors.Add(new(CopyField.Attachments, "请输入 0 至 2147483647 的整数附件张数。"));
        if (!ExactText(currentPreparedBy))
            errors.Add(new(CopyField.PreparedBy, "当前制单人无效，请返回宿主确认当前身份。"));
        if (errors.Count != 0) return new(null, errors.AsReadOnly());

        var result = planner.Plan(shown, sourceId, new(date, input.Kind, number, attachments, currentPreparedBy));
        foreach (var issue in result.Issues)
            errors.Add(new(issue.Code switch
            {
                VoucherCopyIssueCode.DateOutsideBook or VoucherCopyIssueCode.PeriodClosed => CopyField.Date,
                VoucherCopyIssueCode.InvalidKind => CopyField.Kind,
                VoucherCopyIssueCode.InvalidNumber or VoucherCopyIssueCode.NumberAlreadyUsed => CopyField.Number,
                VoucherCopyIssueCode.InvalidAttachmentCount => CopyField.Attachments,
                VoucherCopyIssueCode.InvalidPreparedBy => CopyField.PreparedBy,
                _ => CopyField.General
            }, issue.Message));
        return new(result.Plan, errors.AsReadOnly());
    }

    private static bool ExactText(string? value) => !string.IsNullOrWhiteSpace(value) &&
        value == value.Trim() && !value.Any(char.IsControl);
}
