# Caiwu.Reporting 接入说明

基线：`97d696a3ee7adf100e24b4924438468bd34dd80c` 的 `docs/IMPLEMENTATION_CONTRACT.md` 与 `Caiwu.Contracts`。目标 `net10.0`；生产库仅引用 Contracts，无第三方包。所有新增内容限于 Reporting 与对应测试目录；solution、Desktop、Contracts、Core、Sqlite、packaging 由主协调集成。

提供凭证清单、科目余额表、科目明细账的不可变呈现快照，以及 CSV、本地可打印 HTML。未实现资产负债表、利润表或民非财务报表；科目余额表保留明确名称与账簿数据说明，不构成法定财报。会计制度与版本沿用账套，不根据来源链接推断规则，不宣称制度模板已获生产核验。本模块不依赖原软件或手册图像。

## public API

命名空间 `Caiwu.Reporting`。`ReportBuilder`、`ReportExporter` 均为静态类；同步 API 可由桌面端在受控忙状态中调用。

```csharp
new ReportSource(string title, string address);
new ReportMetadata(BookInfo book, DateOnly from, DateOnly to,
    DateTimeOffset generatedAt, IEnumerable<ReportSource>? sources = null);

ReportDocument ReportBuilder.VoucherList(ReportMetadata metadata,
    IEnumerable<Voucher> vouchers, IEnumerable<Account>? accounts = null,
    VoucherStatus? status = null);
ReportDocument ReportBuilder.TrialBalance(ReportMetadata metadata,
    IEnumerable<TrialBalanceRow> balances, IEnumerable<Account>? accounts = null);
ReportDocument ReportBuilder.Ledger(ReportMetadata metadata, string accountCode,
    IEnumerable<LedgerEntryRow> entries, IEnumerable<Account>? accounts = null);

string ReportExporter.ToCsv(ReportDocument report);
void ReportExporter.WriteCsv(ReportDocument report, TextWriter writer);
void ReportExporter.WriteCsv(ReportDocument report, Stream stream, bool leaveOpen = true);
string ReportExporter.ToHtml(ReportDocument report, HtmlExportOptions? options = null);
void ReportExporter.WriteHtml(ReportDocument report, TextWriter writer,
    HtmlExportOptions? options = null);
void ReportExporter.WriteHtml(ReportDocument report, Stream stream,
    HtmlExportOptions? options = null, bool leaveOpen = true);
new HtmlExportOptions(int rowsPerPage = 12, bool landscape = true);
```

`ReportDocument` 包含 `Kind`、`Title`、`Metadata`、`Columns`、`Rows`、`Total`、`Note`。`Rows` 不含合计，`Total` 是独立行；导出器只添加一次合计。

`ReportColumn.Key` 为稳定绑定键，`Title` 为中文列名，`Kind` 区分文本与金额。`ReportCell.DisplayText` 为显示字符串，`Amount` 为 `decimal?` 原值。金额始终保留两位小数并使用不依赖区域设置的十进制格式。`ReportRow.VoucherId` 用于桌面凭证钻取，`AccountCode`、`AccountDepth`、`IsLeaf` 供科目行绑定。集合为只读快照，调用者不能通过更改输入列表影响已经生成的报表。

| 报表 | 列 Key（按顺序） |
| --- | --- |
| 凭证清单 | `date`, `kind`, `number`, `status`, `accountCodes`, `accountNames`, `summaries`, `debit`, `credit`, `attachmentCount`, `preparedBy`, `reviewedBy`, `voucherId` |
| 科目余额表 | `accountCode`, `accountName`, `level`, `isLeaf`, `openingDebit`, `openingCredit`, `periodDebit`, `periodCredit`, `closingDebit`, `closingCredit` |
| 明细账 | `accountCode`, `accountName`, `date`, `kind`, `number`, `summary`, `debit`, `credit`, `balanceDirection`, `runningBalance`, `voucherId` |

凭证清单默认包含所选期间全部状态，可显式筛选状态，日期边界含首尾。按日期、凭证字（Ordinal）、号码、ID 稳定排序。每张凭证一行，科目编码、科目名称和摘要按原始分录顺序用换行对应保留，分录借贷分别合计。名称从可选目录查找，缺失时显示“未知科目”，编码继续保留。草稿/审核/已记账各有可见状态，清单总计的含义在说明中列明。

余额表按编码 Ordinal 排序，保留全部零余额、负数与父科目行，只累加 Contracts 的 `IsLeaf=true` 行。层级来自可选目录的 `ParentCode`，不从数字前缀猜测；未提供目录时深度为 0。科目名称保留 DTO 原值。明细账保留输入顺序及所有期初行，完全沿用领域服务的 `RunningBalance`，显示借/贷/平方向和借正贷负原值；本期发生额合计只包含日期非空行，不累计逐笔余额。未知科目不丢行。

## 桌面端组合示例

主协调添加项目引用并将两个项目加入 solution 即可，无需修改 Contracts。`ILedgerService` 沿用既有接口；集成方保证余额/明细 DTO 与元数据期间匹配，并在生成期间协调服务快照的一致性。

```csharp
using Caiwu.Contracts;
using Caiwu.Reporting;

var snapshot = service.GetSnapshot(); // ILedgerService
var metadata = new ReportMetadata(snapshot.Book, from, to,
    DateTimeOffset.Now, verifiedSourceLinks); // 来源及制度依据由主协调按真实材料传入
var balances = ReportBuilder.TrialBalance(metadata,
    service.GetTrialBalance(from, to), snapshot.Accounts);
var ledger = ReportBuilder.Ledger(metadata, accountCode,
    service.GetLedger(accountCode, from, to), snapshot.Accounts);
var vouchers = ReportBuilder.VoucherList(metadata,
    snapshot.Vouchers, snapshot.Accounts); // 或 status: VoucherStatus.Posted

// 绑定 Columns 与 Rows；双击行时使用 row.VoucherId 打开已有凭证。
// 用户在桌面保存对话框选择目标后，由宿主负责文件名、覆盖确认与写入错误提示。
using (var output = File.Create(selectedCsvPath))
    ReportExporter.WriteCsv(balances, output);
using (var output = File.Create(selectedHtmlPath))
    ReportExporter.WriteHtml(ledger, output, new HtmlExportOptions(12));
// 本地 HTML 由宿主选择的浏览器打开，再调用浏览器打印。
```

两种导出都记录账套名称/ID、制度、制度版本、期间、含偏移的生成时间、人民币/元及来源标题与原地址。`GeneratedAt` 必须显式传入，以便审计、可重现测试和时区展示；不把浏览器当前时间混入报表。`ReportSource` 仅接受不含凭据或控制字符的绝对 HTTP(S) 链接，保存原地址字符串，包括 Unicode 和查询参数。无来源时不捏造链接。

## 导出行为和错误

CSV 为等宽列数的 RFC 4180 记录，记录分隔为 CRLF。顺序为元数据、说明、列头、数据、合计、来源；元数据/来源占前两列，其余补空。它不是只有数据行的导入文件；如需再次导入，应按列头识别表格区域。文本全部加引号且双写内部引号，保留嵌入换行。危险文本（含前置空白/不可见字符后的 `= + - @`、对应全角符号及前导控制字符）加单引号前缀，范围包括科目、人员、摘要、元数据。此安全前缀是 CSV 文本表示的一部分。金额按受控 decimal 数字输出，负金额仍是数值。Stream 重载输出 UTF-8 BOM；TextWriter/String 重载编码由宿主决定。表格软件可能将长数字编码自动识别为数字，精确保留前导零时应使用“以文本导入”或查看 HTML；CSV 不使用会引入可执行公式的 `="编码"` 写法。

HTML 为自包含 UTF-8 文档，无脚本、外链资源或自动导航，CSP 限制加载。所有动态文本和属性都做 HTML 编码。来源仅以已校验的 HTTP(S) 地址生成链接并打印完整 URL；凭证 ID 同时保留在表格列与 `data-voucher-id`，科目编码在列和安全编码后的 `data-account-code` 中。无需 WebView 与本地服务器即可打印，不包含 JS 凭证钻取；钻取交由桌面数据行完成。

默认 A4 横向，每个逻辑页最多 12 行（合计也占一行）；每页重复标题、元数据、说明和列头，末页显示来源。支持 1–1000 行/逻辑页与纵向。使用打印换页、重复表头、长文本换行与行内避免分页。页脚计数是逻辑页；超高单行、极长摘要/来源、浏览器缩放或字体差异可能增加实际纸张页数，用户应按打印预览调整每页行数。极长金额允许在列内换行以保留完整数字、避免覆盖邻列。

分以下精度抛 `ArgumentException`，合计超 decimal 范围抛 `OverflowException`，不静默舍入。反向/跨账套年度/早于启用月期间、未知制度/状态、日期越界明细、重复凭证 ID/余额科目编码、循环科目关系及不安全来源会明确拒绝。账户借贷方向、审核权限、试算是否平衡等业务校验仍由 Core 负责，Reporting 不生成或更改账务事实。I/O 错误原样抛出，宿主只在写入成功后提示导出完成。

## 实际验证

使用官方 .NET SDK 10.0.402（SHA-512 与仓库 `docs/sdk-metadata.json` 及官方 release metadata 核对）。测试依赖与现有 Core 测试一致：`Microsoft.NET.Test.Sdk [18.11.0]`、`xunit.v3.mtp-off [4.0.2]`、`xunit.runner.visualstudio [4.0.1]`；官方 NuGet 源限定在测试目录的 `NuGet.Config`，传递依赖及内容哈希记录在 `packages.lock.json`。生产库无外部依赖，另有其项目引用锁文件。

```sh
dotnet restore tests/Caiwu.Reporting.Tests/Caiwu.Reporting.Tests.csproj \
  --configfile tests/Caiwu.Reporting.Tests/NuGet.Config --locked-mode
dotnet test tests/Caiwu.Reporting.Tests/Caiwu.Reporting.Tests.csproj \
  --no-restore --configuration Release
```

实际运行：44 项通过，0 失败，0 跳过。测试覆盖独立手算契约样例（本期借贷各 31200、期末借贷各 120000）、父子汇总去重、零余额、负余额、多级任意编码、未知科目、Unicode、凭证 ID、来源地址/版本/期间/时间、0.1+0.2、精度拒绝/decimal 极限、空表、日期状态筛选、不可变快照、CSV 攻击文本与 RFC 回读、HTML 编码、10000 行分页与无丢行、BOM/流所有权、I/O 失败传播。

浏览器实测边界：在 Linux 容器用已安装 Chromium 对生成的本地 HTML 发起 `file://` 导航，返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`。停止了该浏览器验证，未修改策略，未获得真实打印 PDF 或截图；不得据单元测试声称浏览器/打印机验收完成。Windows 桌面接入、实际浏览器打印预览与真实打印机尚需主协调验收。
