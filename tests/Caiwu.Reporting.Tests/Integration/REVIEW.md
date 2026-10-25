# Reporting 有限质量审查（2026-10-25）

读取的远端集成头为 `codex/windows-mvp@037a07585078d4dfcd443a2cc4a237c88aed07a0`；源材料为该提交的 Desktop、Core、SQLite 及 Contracts。使用单独工作树叠加 Reporting 实现进行测试，未修改其他 owner 源文件或 solution。本记录不能代表此提交之后的 UI 接入状态。

## Reporting 已修复项

`ReportBuilder` 的 decimal 累加原先可能在极端 DTO 上静默损失分值：CLR 将 `decimal.MaxValue + 0.01m` 仍表示为 `decimal.MaxValue`，不抛溢出。新增仅使用 BCL `BigInteger` 的精确整数分值校验，覆盖凭证内合计、跨凭证合计、余额表各列末级总计、明细账本期合计；不能精确表示时明确抛 `OverflowException`。没有改变 Contracts/Core/SQLite 的金额范围，没有新增依赖。正常 Int64 分范围的合成账套与原 10000 行用例继续通过。单元测试增加正负极端值及三类报表的回归。

## Desktop owner 待办（本任务未修改）

1. **旧 CSV 防公式覆盖不足。** `src/Caiwu.Desktop/Presentation/CsvExporter.cs:30` 只做 `TrimStart()` 后查 ASCII `=+-@`。直接编译该源文件的临时探针确认：普通 `=1+1` 输出带单引号；`\uFEFF=1+1`、`\u200B=1+1`、`\uFF1D1+1` 输出无单引号。Core `LedgerService.Text` 接受并持久化前两种 Format 字符开头的摘要，真实 SQLite 用例已复现其可达性。这里证明的是保护缺口，未在 Excel 中执行公式。应把 UI 三类业务报表接到 `ReportExporter`；不要继续复制旧编码器。
2. **实际 UI 导出尚未接 Reporting，且元数据与追溯信息丢失。** `src/Caiwu.Desktop/MainWindow.xaml.cs:338–354` 当前只将扁平 `Headers/Rows` 传旧 `CsvExporter`。CSV 不含制度版本、查询起止日、生成时间、来源链接或凭证 GUID；余额表 `TrialTotalsText` 仅留在 `Footnote`，未传 CSV，父/子行又未标出 `IsLeaf`。打印路径 `:359` 也只有年度，未带精确查询期间与制度版本。按 Reporting README 传原始 DTO 与 `ReportMetadata` 可解决；保留当前凭证状态和关键词筛选结果，避免改成整份 Snapshot 后额外导出未选中的凭证。
3. **凭证摘要有截断。** `src/Caiwu.Desktop/Presentation/EntryModels.cs` 的 `VoucherListRow.Summary` 只取首条分录；`CurrentReport` 沿用这个值，后续分录摘要不进入旧 CSV。Reporting 的按分录顺序多行科目/摘要已经保留完整文本，接入应使用原 `Voucher`。

没有把现有明细 UI 的“方向＋绝对余额”误报为符号错误：该表达本身正确。接 Reporting 时必须传 `LedgerEntryRow.RunningBalance` 原值，不能把 `LedgerDisplay.Balance` 的绝对值当有符号输入。余额表 UI 在 `QueryTrial` 只累计 `IsLeaf`，本次未发现其已有总计父子重复；待办是让导出保留同样的语义和标识。

Reporting 的导出器只接收 Stream/TextWriter，不自行打开文件、查询网络、读取数据库路径或导出 AuditEvents。源码审查未发现自动外发路径；测试确认生成内容不含仅出现在审计事件中的操作人标记或账套本地路径。账套名称、制单/审核人及显式来源 URL 是预期导出字段。目标文件选择、覆盖提示和防止选到在用账套/日志文件仍由宿主负责。

## 真实运行证据

- SDK：已校验官方 SHA-512 的 .NET SDK 10.0.402；Release，`TreatWarningsAsErrors=true`。
- 单元测试：45 通过、0 失败、0 跳过；含原有 10000 行导出和新精度回归。
- 新独立集成项目：9 通过、0 失败、0 跳过；项目及传递包锁定在本目录 `packages.lock.json`，官方 NuGet 配置沿用上层。
- 集成用例创建临时真实 SQLite 账套，使用 Core 设置科目与期初、保存/审核/记账，再关闭重开；输出三类实际 CSV/HTML 文件并用 .NET `TextFieldParser` 独立回读 CSV。
- 独立手算样例本期借贷各 31200、期末借贷各 120000、银行 108800；多级总计只计末级；反向银行余额保留贷方 -1000；子期间将此前分录滚入期初；草稿/已审核不影响账簿；同凭证多分录 ID 不丢失；恢复副本在固定生成时间下得到完全相同的 CSV/HTML。
- 没有发现这组样例中的 Core/SQLite 会计显示或计算错误；不扩大解释为全部制度或全部边界已验收。

此前 Chromium 的本地 HTML 导航被管理员策略阻止；本轮未重试该操作，也未修改策略。实际浏览器打印排版、Windows UI 接入和打印机验收仍未完成。
