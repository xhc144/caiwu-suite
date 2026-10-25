using Caiwu.Contracts;
using Microsoft.Data.Sqlite;

namespace Caiwu.Desktop.Presentation;

public static class SaveError
{
    public static string Message(Exception exception) => exception switch
    {
        SqliteException { SqliteErrorCode: 5 or 6 } => "账套正被另一操作占用。输入已保留，请待该操作完成后重试。",
        StoreConcurrencyException => "账套已被其他操作修改。输入已保留；请先核对最新凭证，再重新打开编辑，避免覆盖他人修改。",
        LedgerValidationException or ArgumentException or OverflowException => exception.Message,
        _ => "保存未能确认完成，输入已保留。请先核对账套和凭证列表，确认结果后再处理。"
    };
}
