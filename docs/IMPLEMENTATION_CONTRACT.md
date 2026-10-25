# 首版并行实现契约 v1（2026-10-25）

项目在 `/workspace/caiwu-suite-dev` 自研。原安装器和提取材料位于 `/workspace/caiwu-suite-investigation`，实现任务不得修改或复制其代码、图标和图片。另一个挂载仓库不属于本项目。用户后续明确授权向私有 `xhc144/caiwu-suite` 开发分支提交/推送并建立草稿PR；不授权公开发布、改main/权限、运行原安装器。远端集成写入统一由主集成任务完成。

## 技术与目录 ownership

目标 `.NET 10`，WPF `net10.0-windows` + SQLite；共享库与测试 `net10.0`。Linux构建WPF使用 `EnableWindowsTargeting=true`，构建通过不等于Windows交互已验。

| 所有者 | 独占修改路径 | 职责 |
|---|---|---|
| 主集成任务 | `src/Caiwu.Contracts/**`、`src/Caiwu.Desktop/**`、根solution/props/global.json、`docs/**`、`packaging/**`、根README、`.ai-handoff/**` | 固定DTO/接口，传统桌面UI、组合根、构建及交付 |
| 账务领域任务 | `src/Caiwu.Core/**`、`tests/Caiwu.Core.Tests/**` | 实现 `LedgerService`、模板目录、金额与状态规则、账簿计算、领域测试 |
| SQLite任务 | `src/Caiwu.Persistence.Sqlite/**`、`tests/Caiwu.Persistence.Sqlite.Tests/**` | 实现 `SqliteLedgerStore`、关系表与迁移、事务并发约束、备份/恢复及持久化测试 |

禁止修改其他owner文件。新增接口需求先报告主集成，主集成统一改契约。两个实现任务无需改solution，由主集成收集项目后加入。测试只引用自己的项目和Contracts；领域可用内存store测试，不依赖SQLite。SQLite任务不依赖Core，不在SQL里另造一套审核/结账规则。

依赖：`Core→Contracts`；`Persistence.Sqlite→Contracts`；`Desktop→Contracts+Core+Persistence.Sqlite`。无循环依赖。项目均启用Nullable/ImplicitUsings，C#默认.NET10语言版本。

## MVP范围

真实创建/打开账套、科目与期初余额、凭证保存/修改/删除草稿、审核、记账、余额表、科目明细→凭证、期间锁、备份和从备份恢复副本。先用人民币、单会计年度、月期间，金额两位小数；税务/多币种/原账套导入/年结/任意报表设计器不假装已完成。

UI贴近手册的菜单、工具条、密集表格、纸式凭证及F4/F7键盘流。首版制度包可以标为试用且待会计复核，不声称任何规则已经合规验收。根线程将补充最新官方规则，不能从旧手册直接固化反记账/反结账。

## 共享模型（主集成创建，类型名与字段顺序冻结）

命名空间统一 `Caiwu.Contracts`。所有列表用 `IReadOnlyList<T>`；模型为sealed record；金额用decimal，落盘由SQLite转Int64分。DateOnly用ISO日期，Guid写规范字符串。禁止double金额。

```csharp
enum AccountingRegime { SmallBusiness, Enterprise, Nonprofit }
enum BalanceDirection { Debit, Credit }
enum VoucherStatus { Draft, Reviewed, Posted }

record BookInfo(Guid Id, string Name, AccountingRegime Regime,
    string TemplateVersion, int FiscalYear, int StartMonth,
    int ClosedThroughMonth, DateTimeOffset CreatedAt);
// ClosedThroughMonth初始化为StartMonth-1。单年度MVP，不能改账套制度覆盖旧账。

record Account(string Code, string Name, string? ParentCode,
    BalanceDirection Direction, bool IsActive,
    decimal OpeningDebit, decimal OpeningCredit);
// 是否末级按ParentCode关系计算。只有active末级可用于分录。

record VoucherLine(string AccountCode, string Summary, decimal Debit, decimal Credit);
record Voucher(Guid Id, DateOnly Date, string Kind, int Number,
    int AttachmentCount, string PreparedBy, string? ReviewedBy,
    VoucherStatus Status, IReadOnlyList<VoucherLine> Lines);
record VoucherDraft(Guid? Id, DateOnly Date, string Kind, int? Number,
    int AttachmentCount, IReadOnlyList<VoucherLine> Lines);
// 新建Id=null；Number=null时分配该年度/月份/Kind内下一号。
// 凭证状态由service控制，不从UI传入。已审核/记账凭证不准原地删改。

record OpeningBalance(string AccountCode, decimal Debit, decimal Credit);
record AuditEvent(Guid Id, DateTimeOffset At, string OperatorName,
    string Action, Guid? VoucherId, string Detail);
record LedgerSnapshot(long Revision, BookInfo Book, IReadOnlyList<Account> Accounts,
    IReadOnlyList<Voucher> Vouchers, IReadOnlyList<AuditEvent> AuditEvents);

record TrialBalanceRow(string AccountCode, string AccountName, bool IsLeaf,
    decimal OpeningDebit, decimal OpeningCredit, decimal PeriodDebit,
    decimal PeriodCredit, decimal ClosingDebit, decimal ClosingCredit);
// Parent行汇总，UI总计只加IsLeaf。期初含from之前的posted分录。

record LedgerEntryRow(DateOnly? Date, Guid? VoucherId, string VoucherKind,
    int? VoucherNumber, string Summary, decimal Debit, decimal Credit,
    decimal RunningBalance);
// RunningBalance为借方正、贷方负；首行Date/Id=null、Summary=期初余额。

record TemplateDefinition(string Id, string DisplayName, AccountingRegime Regime,
    string Version, bool IsVerifiedForProduction, IReadOnlyList<Account> Accounts);
```

## 共享接口（主集成创建）

```csharp
public interface ILedgerStore : IDisposable
{
    string DatabasePath { get; }
    LedgerSnapshot Read();
    void Write(LedgerSnapshot next, long expectedRevision);
    void BackupTo(string destinationPath);
    void CheckIntegrity();
}
// Write必须在单SQLite事务中校验当前revision==expectedRevision，
// 且next.Revision==expectedRevision+1；否则抛StoreConcurrencyException。
// 允许MVP每次按完整snapshot替换关系表，禁止半次凭证/过账。
// Read与Write须保留所有字段。金额>2位/溢出不能静默截断。

public interface ILedgerService
{
    LedgerSnapshot GetSnapshot();
    void SaveAccount(Account account, string operatorName);
    void DeleteAccount(string code, string operatorName);
    void SetOpeningBalances(IReadOnlyList<OpeningBalance> balances, string operatorName);
    Voucher SaveDraft(VoucherDraft draft, string operatorName);
    void DeleteDraft(Guid id, string operatorName);
    void Review(Guid id, string reviewer);
    void CancelReview(Guid id, string operatorName);
    void Post(Guid id, string operatorName);
    void CloseMonth(int month, string operatorName);
    IReadOnlyList<TrialBalanceRow> GetTrialBalance(DateOnly from, DateOnly to);
    IReadOnlyList<LedgerEntryRow> GetLedger(string accountCode, DateOnly from, DateOnly to);
}
// LedgerValidationException(message)供UI展示可理解错误；
// StoreConcurrencyException(message)供UI提示刷新重试。
// 两种异常类也由Contracts提供。意外系统异常不可吞掉伪装成功。
```

## 两块实现的公开入口（须保持精确）

领域命名空间 `Caiwu.Core`：

```csharp
public sealed class LedgerService : ILedgerService
{
    public LedgerService(ILedgerStore store);
    // 实现上面全部方法；不自行dispose传入store。
}
public static class TemplateCatalog
{
    public static IReadOnlyList<TemplateDefinition> All { get; }
    public static TemplateDefinition Get(AccountingRegime regime);
}
```

基础模板至少支持演示样本科目：银行存款、原材料、实收资本、主营业务收入、管理费用、本年利润；具体代码按所属制度选取。三种模板要有独立Id/Version，不能只换名称声称符合制度。民非可提供经根线程规则更新的初版科目，但 `IsVerifiedForProduction=false`。SaveAccount验证编码/父子关系/精度，已有引用的科目不能直接改经济属性或删除；DeleteAccount拒绝有子科目、非零期初及任何凭证引用的科目。

SQLite命名空间 `Caiwu.Persistence.Sqlite`：

```csharp
public sealed class SqliteLedgerStore : ILedgerStore
{
    public static SqliteLedgerStore Create(string path, BookInfo book,
        IReadOnlyList<Account> accounts);
    public static SqliteLedgerStore Open(string path);
    public static void RestoreBackup(string backupPath, string newDatabasePath);
}
```

Create拒绝覆盖现有文件，初始revision=0；Open只开已存在文件，不把错误路径初始化为空账套。当前schema=1，记录应用schema版本；未知较新schema拒绝写入。BackupTo用SQLite备份API，拒绝覆盖唯一源账套；RestoreBackup先校验再写入新路径、禁止覆盖已有文件。生命周期由UI管理，换账套时dispose旧store。同步API首版即可，UI通过受控忙状态调用。

建议NuGet `Microsoft.Data.Sqlite`，具体可用最新受支持版本由实现时官方源核验并固定。不能携带或执行原包ASA/PB运行库。不得生成签名证书或凭据。

## 必须覆盖的测试与集成门槛

领域：0.1/0.2精度、非法科目和不平衡、月/年范围、编号唯一、不可改审核/记账数据、制单/审核身份分离、重复记账不重复影响余额、结账月内未记账阻断、期间锁、父子汇总与凭证钻取。更正策略先留待根规则审定，不能照搬反结账。

数值样本：期初银行借100000、资本贷100000；材料借10000/银行贷10000；费用借1200/银行贷1200；银行借20000/收入贷20000。全部posted后银行108800、材料10000、费用1200、收入贷20000；本期借贷各31200、期末借贷各120000。数据来自独立手算，不能把实现本身作为预期。

SQLite：所有字段round-trip、readonly/缺文件/坏文件、Write并发revision拒绝、异常回滚、金额精度拒绝、一致性备份、恢复副本、schema前向拒绝、两个账套隔离。测试结果和实际NuGet版本随交付提供，未运行项明确标注。

权限记录：最初根报告含push/草稿PR的指令被拒绝、未执行；其后用户对该确切操作明确回复“完全,全部允许,都允许”，根已传回新增授权。当前可以对指定私有仓库开发分支推送并创建草稿PR，先核对远端防重复；若重试仍被拒绝则停止该动作，不绕过。原安装器运行仍不在授权范围内。

## 已收到的规则资料

根提供的Library文件 `libfile_8d0bfe9cdb3881918d065fc065a48560` 已通过当前Library工具及原版传输助手materialize成功，身份xattr已核对。ZIP 37,397字节，SHA256 `7975d686cfc8467b3d926963f820cfaa30a6a2cfc2e8867433cbdf420dcde3be`。本容器真实路径：`docs/rules-source/unpacked/enterprise-cost.md`（27,248字节）、`nonprofit.md`（28,044字节）、`software-records.md`（35,256字节），全部可按UTF-8读取。

已读取关键条目：财会〔2024〕12号不可逆记账、民非2026收入费用分别按限定性/非限定性及同码异义迁移、新企业第30号分阶段执行、科目征求稿不作现行依据。首版Core不实现Unpost/Reopen等接口；民非完整规则尚未实现前只列实验模板，不宣传生产覆盖。

UI选择：采用.NET10 WPF、内建Fluent资源字典与自有紧凑样式，避免实验性ThemeMode API和额外UI包。WPF成熟DataGrid、键盘路由、打印和DPI能力适合财务工作页；不用旧灰色控件外观，也不改成稀疏网页仪表盘。参考 https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net100 。
