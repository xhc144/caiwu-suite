# 出纳保真升级：第一垂直切片

基线 `main@3b0c59b02d8941c32ac176309555c03c94bb4213`，本模块只拥有自己的源代码、测试和 [交接](../../docs/parity-handoffs/cashier.md)。不把旧 0.1.0.4 作为完成依据。

`CashierService` 提供账户期初（整屏原子存盘）、单据增加/修改/删除、带连续余额和本日小计的日记账、对账读入/手工分组/自动选择/整组取消，以及逐条或按月生成的借贷平衡凭证计划。账户必须来自明确的现金流量标志和币种目录，不根据科目代码前缀猜测。单号自动生成且删除后不复用。金额用 decimal 保存，不统一压成分。

单据金额遵照原静态规则 `abs(je) >= 0.005`；手工勾账允许原规则的 `0.005` 差额，不修改原值。自动勾销按日期/单号、日期/分录 ID 排序，选择金额完全相同的单条匹配。只纳入已过账的账务分录。手工分组分别比较借/贷合计，以免净额恰好相同掩盖不同资金流；这项保守规则及自动匹配边界需 Windows 原流程复核。以前月份的未勾账数据可勾销/反勾销，单据金额改删继续遵守结账锁。

## 两种存储路径

- `SqliteCashierStore.CreateSynthetic` 只新建明确命名的 `*.cashier-synthetic.db`，不会覆盖文件。`OpenSynthetic` 只接受已存在且 application_id/schema 匹配的模块合成库。整次状态/流水号/勾账组/审计在一个 SQLite IMMEDIATE 事务内按 revision 提交，失败回滚。这不是原 SQL Anywhere 账套导入器。
- `Integration/ParityCashierStore` 对接 PR #52 的 `IParityLedgerService`，把权威模块状态保存在 `cashier/state` 文档，使用同一 `ModuleLedgerSnapshot` 的账套身份与全账套 revision。它不访问独立合成库。公共账务分录为只读来源，不能通过 `StageLedgerSnapshot` 伪造。桥接依赖公共 Core 的实际实现与宿主授权；当前适配测试使用记录型替身，不证明公共存储已通过。

`CashierVoucherProposalAdapter` 从用户所见的同一快照与计划构造可审阅建议，来源键为稳定 `document:{GUID}`。构造建议不提交；宿主确认后显式调用 `AcceptConfirmed`，模块状态变更和来源认领交由公共单账套事务。收据在重开时恢复真正凭证 ID。当前旧 `VoucherLine` 不足以承载外币、辅助项、未知原列、负数和高精度时，桥接拒绝转换；不舍入、不删字段、不假报生成成功。

`OriginalFields` 保存原类型声明、NULL、原始文本和未知列。本切片没有原格式解析器，不能据字段容器存在声称原账套兼容。状态聚合 JSON 适合当前小型切片；高数据量索引与性能尚未验证。

## 构建与验证

需要仓库 `global.json` 对应的 .NET 10 SDK。

```sh
dotnet test tests/Caiwu.Cashier.Tests/Caiwu.Cashier.Tests.csproj
dotnet build src/Caiwu.Cashier/Wpf/Caiwu.Cashier.Wpf.csproj
dotnet build tests/Caiwu.Cashier.Tests/WpfProbe/Caiwu.Cashier.WpfProbe.csproj
```

公共 Contracts 尚未集成到当前分支时，对固定 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的独立只读 checkout 指定路径，不改共享文件：

```sh
dotnet test tests/Caiwu.Cashier.Tests/Integration/Caiwu.Cashier.Integration.Tests.csproj \
  -p:ParityContractsProject=/path/to/pr52/src/Caiwu.Contracts/Caiwu.Contracts.csproj
```

该接口进入集成分支后可省略 `ParityContractsProject`。模块没有修改根解决方案或工作流。

## WPF 的完成边界

`Wpf/CashierWindows` 提供原 `w_cn_lr_qc`、`w_cn_lr`、`w_cn_lr_add`、`w_cn_slz_1`、`w_cn_dz_xz`、`w_cn_dz_ny`、`w_cn_dz` 的可执行窗口/事件。已知外层控件采用原 PBU 的相对矩形，未宣称 PBU 到像素的换算。单据增加/修改强制注入 `ICashierDataWindowFactory`；原 `dw_cn_lr_add` 内部坐标、编辑风格、焦点流未完整恢复，产品代码不猜这些值。日记账第二表面和各表视觉列序也未通过原版对照。

Windows 可运行 `tests/Caiwu.Cashier.Tests/WpfProbe`。它只创建新的临时合成库、预置合成已过账分录，用测试专用表格编辑器完成业务操作；测试表格明确不是原 DataWindow 的视觉还原。其“合成测试入口”直开日记账，不能冒充原版运行时入口。该工具不运行原程序。

Linux 构建与合成测试、Windows 新实现操作、原版逐窗口对照、原账套兼容为四种不同证据。后面三项未完成，原版所有遗漏项继续保留在交接清单。
