using Caiwu.Contracts;

namespace Caiwu.BookTools;

public enum BookCopyScope { FullLedger, AccountsAndOpeningBalances }
public enum BookCopyStage { SnapshotCaptured, TargetSaved, ReadyVerified }

public sealed record BookCopyRequest(string SourcePath, string DestinationPath,
    string NewBookName, BookCopyScope Scope, string OperatorName);

public sealed record BookCopyCounts(int Accounts, int Vouchers, int Drafts, int Reviewed,
    int Posted, int AuditEvents, decimal OpeningDebit, decimal OpeningCredit);

public sealed record BookCopyFieldRule(string Field, string Behavior);

/// <summary>An immutable, reviewable plan. Creating one never writes a file.</summary>
public sealed class BookCopyPlan
{
    internal BookCopyPlan(BookCopyRequest request, LedgerSnapshot source, LedgerSnapshot target)
    {
        Request = request;
        Source = source;
        Target = target;
        SourceFingerprint = SnapshotData.Fingerprint(source);
        SourceCounts = Count(source);
        TargetCounts = Count(target);
        Rules = Array.AsReadOnly(new[]
        {
            new BookCopyFieldRule("Book.Id / Name / CreatedAt", "使用预览中列明的新身份、新名称和新建时间。"),
            new BookCopyFieldRule("Revision", target.Revision == 1
                ? "新账套从版本 1 开始，源 token 不适用于新 BookId。"
                : "完整复制包含模块历史：新版本为源版本加一，所有历史收据版本均小于新版本；旧收据和内嵌旧 BookId 不是新账套 token。"),
            new BookCopyFieldRule("Regime / TemplateVersion / FiscalYear / StartMonth", "原样保留；不迁移制度、不滚年、不把期末转为期初。"),
            new BookCopyFieldRule("Accounts", "保留顺序、编码、名称、父级、方向、启停及原始期初金额。"),
            new BookCopyFieldRule("Vouchers", request.Scope == BookCopyScope.FullLedger
                ? "保留全部凭证及分录顺序、凭证 ID、编号、状态、制单和审核人；ID 在账套内使用，不重编号。"
                : "不复制凭证；期初只取原始期初，不累加任何已记账发生额。"),
            new BookCopyFieldRule("ClosedThroughMonth", request.Scope == BookCopyScope.FullLedger
                ? "保留原已结账期间，不解锁历史。" : "重置为 StartMonth - 1，新账套尚未结账。"),
            new BookCopyFieldRule("AuditEvents", request.Scope == BookCopyScope.FullLedger
                ? "完整保留原事件及已删除凭证的历史引用，追加一条 BookCopiedAsNew 来源事件。"
                : "不复制旧事件、模块文档或来源收据，仅写入一条 BookCopiedAsNew 来源事件。"),
            new BookCopyFieldRule("Module journal", request.Scope == BookCopyScope.FullLedger
                ? "逐字保留模块事件/未知 JSON/来源占用；内嵌源 BookId 仅作历史，不自动重写或授予新账套写入权。模块需显式核对身份。"
                : "本范围不包含模块文档、模块凭证和来源占用；不得称作模块完整备份。")
        });
        Notices = Array.AsReadOnly(new[]
        {
            "这是自研 schema-v1 DTO 的结构化复制，不是原程序功能复刻或原账套导入。",
            "全量仅指当前契约字段：不含实际附件文件、外部报表、用户权限或其他契约外资料。",
            "恢复副本继续使用 Storage.RestoreBackup 并保留原身份；本操作明确创建新账套。",
            "仅复制已持久化数据；未保存编辑不包含在内。宿主须先结束编辑并确认此预览。",
            "执行复制预览的那个一致快照。快照取得后源可继续变化；新变化不会混入本次复制。",
            "新账套继承原制度的支持限制，民非或未经验证模板不会因复制获得生产支持。"
        });
    }

    public Guid PlanId { get; } = Guid.NewGuid();
    public BookCopyRequest Request { get; }
    public BookInfo SourceBook => Source.Book;
    public BookInfo NewBook => Target.Book;
    public long SourceRevision => Source.Revision;
    public long NewRevision => Target.Revision;
    public string SourceFingerprint { get; }
    public BookCopyCounts SourceCounts { get; }
    public BookCopyCounts TargetCounts { get; }
    public IReadOnlyList<BookCopyFieldRule> Rules { get; }
    public IReadOnlyList<string> Notices { get; }
    internal LedgerSnapshot Source { get; }
    internal LedgerSnapshot Target { get; }

    private static BookCopyCounts Count(LedgerSnapshot s) => new(s.Accounts.Count, s.Vouchers.Count,
        s.Vouchers.Count(v => v.Status == VoucherStatus.Draft),
        s.Vouchers.Count(v => v.Status == VoucherStatus.Reviewed),
        s.Vouchers.Count(v => v.Status == VoucherStatus.Posted), s.AuditEvents.Count,
        s.Accounts.Sum(a => a.OpeningDebit), s.Accounts.Sum(a => a.OpeningCredit));
}

public sealed record BookCopyResult(Guid PlanId, string DestinationPath, BookInfo Book,
    long Revision, BookCopyCounts Counts, string SourceFingerprint, string SavedFingerprint,
    IReadOnlyList<string> CleanupWarnings);
