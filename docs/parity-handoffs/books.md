# books 原版保真切片交接

状态：**partial — 本币总账/现金银行日记账切片已编译、合成测试通过，Windows 与原账套未验**。2026-10-26 UTC；独立 checkout `/workspace/caiwu-books`；私有分支 `codex/parity-books-20261026`；草稿 [PR #47](https://github.com/xhc144/caiwu-suite/pull/47)。基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`；早期 HANDOFF 提交 `841545bd572946645adb70479a2bd006bcdb110d`；可整合代码 SHA `74649f2841edef3342bf935ba97e2432f6d50098`（本交接另有后续文档提交）。

## 所有权、依据和边界

只修改 `src/Caiwu.Reporting`、`tests/Caiwu.Reporting.Tests` 及本 handoff。现有 `SmallBusinessStatement*`、`StatementLedger` 未改。Contracts/Core/Persistence.Sqlite/Desktop/MainWindow、解决方案、公共 props、工作流、默认 `book-project` 均未改。无适用 AGENTS.md。未改 main/合并/发布/公开/权限/凭据，未购买；未运行或重新解析原安装资源，未触碰真实账套，未上传原载荷或新的完整派生资料。

已读原版 README/gap-analysis、轻松账务 zc/zw/菜单/规则、三产品 windows/menu JSON、tables/DataWindow JSON；复核 PR38 `3ba29a0`、PR39 `11a8d77`、PR40 `8de73d5`。PR38 等待 PB 源工程的旧前提已被用户明确授权覆盖；PR39 的原数据保全义务和 PR40 的 unknown/not-tested 区分继续遵守。六个账簿条件/结果对象在三产品的 `props/controls/events` 定点比较相同，不扩大成原库/源码全部相同。

## 已完成的垂直切片

| 原窗口 / 入口 | 实际行为 | 当前验收边界 |
|---|---|---|
| `w_zc_zc → w_zc_zc_1`；`m_frame_zw/m_o/m_o30/m_o30_00` | 年度/科目从到条件；仅已过账；期初、每月发生额、本年累计、跨月守恒；含实际损益结转凭证 | 算术及现有 ledger 通路已测；原 DataWindow 视觉/打印与实机未验 |
| `w_zc_xjrjz → w_zc_xjrjz_1`；`.../m_o30_10` | 科目从到、年度/月区间、本币、包含未过账选项；逐笔、月计/累计、红字、科目层级 | 合成输入和 SQLite 重开已测；不能冒称原出纳独立程序的日记账已实现 |
| `w_zc_yhrjz → w_zc_yhrjz_1`；`.../m_o30_20` | 上述查询及结算类别/支票号/银行票据/来源键保留；对方科目从同凭证对方分录计算 | 直接扩展 DTO 支持已测；简化 Contracts 缺的字段不能填空冒称兼容 |
| `w_pz_km_find`、结果窗 `m_work_zc_01` 的本切片动作 | 科目查找真实过滤；另存 CSV/HTML、重选、预览、系统打印、记录移动、返回；有宿主真实 handler 时联查凭证 | WPF/Smoke 可编译，实际交互、保存对话框、打印机未运行；未提供的动作不做假按钮 |

来源已知的 PBU 控件起点用于条件窗、结果头和科目查找；保留上下/左右关系，未猜 PBU 像素倍率。下拉关闭高度与字体为新实现参数，不声称已匹配原运行布局。表格屏幕列序、原工具栏的运行时排列、原表格视觉、原打印格式继续 unknown/not-tested。结果 `BooksResultView` 可嵌入原 MDI sheet；独立 `BooksWindow` 只是模块 host，未改造主产品导航。

## API 与文件图

- `Books/BooksModels.cs`：模块 DTO、查询、逐笔/期初/月计/累计及分科目结果，余额计算借正贷负，显示方向+绝对额。置信度 high，合成测试支持。
- `Books/BooksReportBuilder.cs`：从完整单年度本币 ledger 计算；父子关系按 ParentCode；显式现金/银行分类；平衡/日期/行序/精度验证；年中启用需要启用前累计。high。
- `Books/BooksSnapshotAdapter.cs`：`FromSnapshot(LedgerSnapshot, journalKinds?, preOpeningActivity?, baseCurrencyName)` 适配现有简化 ledger，绝非 SQL Anywhere 迁移器。high，领域/SQLite 测试支持。
- `Books/BooksDocumentBuilder.cs`：`Create(BooksResult, accountCode, generatedAt)` 复用 ReportExporter，月计/累计不重复合计；注入/中文/前导零保留。high。
- `Books/IBooksLedgerSource.cs`：实际可读年度列表和 ReadYear；单年度 source；`BooksVoucherReference(BookId,Revision,FiscalYear,VoucherId)`。high（类型/构建）；跨年度 UI 运行未验。
- `Books/BooksModuleAdapter.cs`、`BooksProjectionOptions.cs`：PR52 同版本只读适配、字段注释匹配及原文保留。high（精确契约隔离合成测试）；生产 Core 接通未验。
- `Wpf/` 独立项目：`BooksWindow.Open(owner, source, kind, fiscalYear, openVoucher?)`；`BooksResultView(source,input,query,closeSheet,openVoucher?)`。medium，交叉编译通过，Windows 未运行。closeSheet 必须关闭当前 sheet；查看凭证处理器由 ledger/shell owner 绑定，没有 handler 时不提供查看动作，禁止另造空凭证窗口。
- `tests/.../BooksParityTests.cs`：完全合成 fixture、异常输入、金额/结转/月份分割/导出验证。`Integration/BooksParityLedgerIntegrationTests.cs`：实际 LedgerService + SQLite 的可丢弃合成账套。high。
- `WindowsSmoke/`：新 WPF 条件/结果窗、相对起点顺序、联查参数/移动/关闭和 PNG/JSON 采集工程。medium，只编译，未生成或伪造截图。运行说明见该目录 README。

详细 API/示例：`src/Caiwu.Reporting/Books/README.md`。不增加解决方案项，由集成者统一处理。

## PR52 公共接口检查点与接线

读取精确 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 `ParityModules.cs` 和 integration handoff；没有将 PR52/浮动分支合入本分支。Reporting 和其测试项目在该 Contracts 文件存在时自动启用 `CAIWU_PARITY_MODULES_V1`，编译 `BooksModuleAdapter` 及其测试。基线单独可编译。

宿主一次 `state = IParityLedgerService.GetModuleSnapshot()`；从**同一 state** 的权威模块字段生成 `BooksProjectionOptions`，再 `BooksModuleAdapter.FromSnapshot(state, options)`。选项的 BookId/Revision 必须匹配；票据注释按 VoucherId/行号并检查科目/摘要/借贷值，陈旧/缺失行引用拒绝；不能刷新 token 规避冲突。返回 `Input` 仅用于本币查询，`RetainedDocuments` 逐字保留所有模块文档原始 JSON（含辅助、外币、数量和未知原列），不重写或覆盖权威字段。

`BooksModuleAdapter.Registration(product)` 仅支持已核三产品，ModuleId=`books`、ContractVersion=1、原菜单三入口。这是描述性注册，shell 仍需绑定真正 `BooksWindow/BooksResultView` 和 OperatorSession 权限。模块只读，不需要 SaveModuleDocuments/AcceptVoucherProposal；没有独立外部 JSON 作为权威数据，不声称跨文件原子一致。生产 Core/SQLite 模块状态接通必须在 PR52 实现后另验。

### 必要字段/权限/模式缺口

1. 现 Account 不含原 `kmbm` 的现金/银行账户类别、复币/数量/项目/客供/部门/个人/往来标志；必须由兼容/集成层保留并明确映射，不能按 1001/1002 前缀猜。原 schema 有变体，`zhlb/xjs` 等准确语义不能仅凭列名定案。
2. 现 VoucherLine 缺原行号、`jslb`、`pz_ph/pjdh`、`xmbm/dwbm/bmbm/grbm`、外币/汇率/数量及未知列。直接 BooksLine 只处理本币所需信息；完整原始列仍保留在权威模块/兼容状态，不能由此窄 DTO 迁移回写。原行号/现简化数组序号的映射由 adapter 调用方核实。
3. 年中启用须给每个末级科目成对的启用前本年借贷累计，即使为0也须明确；与启用首日期初分开。缺失时当前查询拒绝，避免假本年累计。原 nc/hz 字段到这两组语义的映射仍需兼容层核验。
4. 只读查询/导出与凭证联查权限由真实 OperatorSession 执行；修改/删除需要原权限、逆审核/逆过账和统一事务，当前报告不直接写库。联查必须保持 BookId/Revision/VoucherId。
5. 多年度 source 必须返回实际对应年度且同一账套；未提供年份不提供有效箭头操作。原数据库 SQL Anywhere 读取、所有模板变体保全和年度身份映射不由此切片假设。

## 本轮真实验证

环境 Linux，SDK 10.0.402。以下最终命令退出0：

- `dotnet test tests/Caiwu.Reporting.Tests/Caiwu.Reporting.Tests.csproj -p:RestoreLockedMode=true --nologo`：81通过、0失败/跳过，其中本轮 books 26项；其余为已有报表测试，未把总数当新增数。
- `dotnet test tests/Caiwu.Reporting.Tests/Integration/Caiwu.Reporting.Integration.Tests.csproj -p:RestoreLockedMode=true --nologo`：11通过、0失败/跳过，其中本轮 books 1项；实际 SaveDraft/Review/Post/CloseMonth、SQLite 重开、领域余额对照、CSV/HTML及查询前后 snapshot/audit/revision 一致。
- `dotnet build tests/Caiwu.Reporting.Tests/WindowsSmoke/Caiwu.Books.WindowsSmoke.csproj -p:RestoreLockedMode=true --nologo`：Reporting、WPF和Smoke交叉编译成功，0警告/错误。**未执行 Windows 应用**。
- 独立 `/workspace/caiwu-books-contract-check` 验证目录，仅注入 PR52 精确原版 ParityModules.cs（未改共享 checkout Contracts），同一根测试命令：84通过，其中3项仅 PR52 adapter；验证原 JSON 字节文本、同版本/同账套限制、注释行匹配和三个注册入口。不是 PR52 Core/事务功能验证。
- `git diff --check` / 提交前暂存区空白检查通过；只包含所属目录及本 handoff，无原资源、真实账务或完整新派生资料。

初次构建遇 .NET 写入默认用户目录/命名互斥体的只读文件系统错误，使用工作区内 CLI/NuGet 目录，工具批准的一次构建升级权限初始化后解决；`dotnet build --locked-mode` 无效参数改为 `-p:RestoreLockedMode=true` 后通过。没有自动审批拒绝、待决写入或结果不明的提交。

## 未实现/未验清单与下一步

保留原 gap-analysis 全部验收；本轮没有删行：辅助明细/辅助余额及各维度期初，辅助多栏/多栏账，外币与数量账，现金流量试算，账龄/费用/合同分析，旧 Excel 格式/批量导出，套打/连续打印，格式记忆/恢复，原排序，凭证查看完整原窗口联动及修改/删除，跨年滚年，SQL Anywhere 原账套全部字段/模板兼容，三产品 Windows DPI/键盘/MDI/原打印验收。总账的单月联查尚未实现；当前月计行不伪造单张凭证。

下一步由集成者先接 PR52 权威 snapshot + 显式字段映射，再在原主菜单/MDI 中接模块窗口，绑定真实凭证 handler/权限；按 WindowsSmoke README 运行新实现合成验证并检查截图。当前阻塞的确切动作是**在 Windows 桌面执行新 WPF Smoke 及打印/交互验收**，原因本环境仅 Linux；状态未执行/待 Windows 环境，非权限拒绝。原程序/真实账套验收按本次限制未运行，不能以合成测试替代。
