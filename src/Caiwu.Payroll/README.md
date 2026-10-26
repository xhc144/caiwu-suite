# 工资模块：原流程第一切片

独占项目，不修改共享 Contracts/Core/SQLite/MainWindow/解决方案。原版目标和剩余验收见 [payroll handoff](../../docs/parity-handoffs/payroll.md)。这是可运行、可持久化的有限业务切片，不是原版工资系统全部完成，也不是原 SQL Anywhere 账套转换器。

## 业务与存储

`PayrollService` 完成部门/人员维护、栏目/公式保存、月工资建立、输入/统一置数/空值设零、依赖排序计算、工资表及 CSV、工资发放和分配凭证计划。员工基本项、80 金额栏、打印及传递设置均可保留；未解释的原列进入 `OriginalFields`，未来 JSON 属性进入 `ExtensionData`。输入金额用 decimal 保存，不先转 double 或整数分；凭证计划才按人民币分逐项四舍五入，并检查借贷平衡。没有自动补平或猜科目。

两种存储端口实现互斥：

- `SqlitePayrollStore`：独立合成 `.payroll.sqlite` 工作文件，独立 application_id/version/BookId；排他新建，未知格式只读拒绝。整个模块快照事务保存，revision 检查阻止旧窗口覆盖。它没有原账套读取、受管备份、跨数据库原子性或主账套权威地位。
- `Integration/ParityPayrollStore`：对 PR52 的契约 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 实现 `IPayrollStore`。权威状态写入 `payroll/payroll-state` 版本 1 的模块 JSON；使用用户所见 `ModuleLedgerSnapshot` 的同一个全账套 revision，不刷新 token 重试。生成计划和转入总账是不同动作。`AcceptPlan` 将来源认领、模块状态与新草稿放进同一个 `VoucherProposal`；无外部文件投影。当前只用接口替身验证，未与真实公共 Core/SQLite 接通。

来源键固定为 `payroll:{BookId}:{Gregorian yyyy-MM}:{Payment|Distribution}`，不能通过改金额、日期、编号或换随机 ID 再支付一次。计划另存内容哈希；相同内容重复生成返回同一计划。凭证设置变更推进配置版本，使旧计算和旧计划过期；须重新计算，再按原凭证请求显式重新生成并确认。仅尚未转入、配置过期的同一请求可替换为新计划 ID，来源键不变、旧 ID 作废。已转入的来源不能如此重生成；原版刷新/覆盖已生成草稿的完整流程尚未实现，不能覆盖已审核/记账凭证。设置内容未变也保留全账套 CAS 校验，不绕过旧窗口冲突。

**公共接口限制：** PR52 `VoucherLine` 尚无辅助维度。计划始终保存人员/部门来源；科目要求部门/人员时 `AcceptPlan` 明确拒绝，不丢维度后转入。项目/客户/外币/数量等也未适配；宿主须完整提供科目元数据，不能把未知要求默认为无要求。没有 `transferToLedger` handler 时 Wpf 不提供空的“转到总帐”按钮，未实现项仍在验收清单。

## 窗口接线

`Wpf/Caiwu.Payroll.Wpf.csproj` 是模块 UI 库，提供 `PayrollWindowFactory`：

| 工厂 | 原对象 | 形式与真实行为 |
|---|---|---|
| `Departments()` | `w_gz_bmwh` | 模态窗；左表右列增加/删除/存盘/退出；引用部门不可删除 |
| `Personnel(closeSheet)` | `w_gz_rsgl` | MDI sheet 的 UserControl；存盘/增加/删除/刷新，原 Ctrl+S/A/D/F4 作用域 |
| 增加员工（由人事窗口打开） | `w_gz_rsgl_ins` | 上基本项，下左工资项、右侧存盘在退出上；编号/姓名/部门校验并持久化 |
| `Columns()` | `w_xt_gzsz` | 90 稳定字段槽位；定义表在存盘/关闭上方；保留原打印/传递/未解释设置 |
| `Formulas()` | `w_xt_gssz / w_xt_gs_edit` | 列表在上，增加/删除/修改/存盘/退出依原 x 坐标顺序在下；编辑左、字段辅助右 |
| `Wages(month,closeSheet,transfer?)` | `w_gz_gzgl` | 真正的月工资表，提交当前编辑格后原子存盘，计算/置数/另存/发放计划/分配计划 |
| 统一置数（由工资窗口打开） | `w_gz_edit_set` | 栏目在值上方；空值设零/确定/取消左至右，实际批量写入 |
| `VoucherSettings()` | `w_pz_sz` | 应付工资科目/栏目、贷方多栏对应、每人分配科目基本项实际保存 |
| `VoucherPlan(month,kind,transfer?)` | `w_pz_build_gz` | 发放在分配左，年月/日期/类型/编号上下排列、生成在退出上；真实生成平衡计划，已注入 handler 才能转总账 |

宿主先显式 `OpenPeriod(month, optionalCarryFrom)`，再打开工资 sheet；月份来自同一账套业务上下文，不能默用机器当天。`PayrollWindowFactory` 可接收宿主的凭证类型列表。用户开始编辑后保留 service/revision，冲突时保留输入并提供显式刷新；不能每次点击保存前重建 service。关闭 sheet 必须调用 `CanClose()`，模态窗自行处理脏数据询问；`closeSheet` 必须关闭当前 sheet，不关闭整套主框架。切账重建 store/service/factory，真实会话授权由宿主负责。

只按已知相对位置布局；DIP 窗口大小是候选可缩放实现，不冒充原 PBU→像素换算。DataWindow 内部列的真实视觉顺序、动态工具栏顺序/图标、窗口模式切换和保存后焦点仍 unknown。当前提供原顺序的操作菜单，未伪造未知工具栏。全量原菜单和未实现按钮须继续按 handoff 验收，不能因本工厂未列出就删除。

## 公式和税参数

支持数值字段 ID、十进制数、NULL、TRUE/FALSE、括号、单目正负、`+ - * / %`、比较、AND/OR/NOT、ROUND/MIN/MAX/ABS/IF/COALESCE。NOT 作用于比较；IF 与逻辑短路，普通运算传播 NULL。公式条件也参与依赖图；未知字段/函数、重复执行目标、循环、除零、溢出均明确失败，整月计算不部分提交。禁用的原公式及其原文可保留，不能把不支持的函数自动改成零。解析限制为 2048 字符、512 节点、64 嵌套、每函数 32 参数、256 公式；不是完整 PB/SQL 表达式引擎。

没有默认税率表或“当前合法”参数。`SaveTaxProfile` 要求参数名、出处文档 HTTPS 地址、定位说明、有效期、起征额与递增税档。`IsTaxFormula` 表示对该公式计算出的税基应用**单期累进算术**，最多一条。测试税率来自明确标注的虚构 fixture，网址 `example.invalid`，绝非法律依据。年度累计预扣、专项扣除、特殊人员规则及原版日期相关计税尚未实现，不能用单期模式替代现行申报。税参数编辑 UI 仍待原套账信息窗口接入，当前有真实配置 API。

## 验证

默认只需 .NET SDK 10.0.402，可单独运行，不改解决方案：

```sh
dotnet test tests/Caiwu.Payroll.Tests/Caiwu.Payroll.Tests.csproj
dotnet build src/Caiwu.Payroll/Wpf/Caiwu.Payroll.Wpf.csproj -warnaserror
dotnet build tests/Caiwu.Payroll.Tests/WindowsSmoke/Caiwu.Payroll.WindowsSmoke.csproj -warnaserror
```

公共契约接入后：

```sh
dotnet test tests/Caiwu.Payroll.Tests/IntegrationTests/Caiwu.Payroll.Integration.Tests.csproj
```

本 checkout 没有修改基线 Contracts；验证时只把冻结 SHA 的 Contracts 与公共 props 复制到另一个只读证据目录，再传 `-p:ParityContractsProject=/path/to/frozen/src/Caiwu.Contracts/Caiwu.Contracts.csproj`，不把替身接口复制入模块或公共源码。

跨进程持久化探针（`create` 只接受新目标，路径/ID自行选取）：

```sh
dotnet run --project tests/Caiwu.Payroll.Tests/ReopenProbe -- create /tmp/new.payroll.sqlite 41eed7d1-b9e1-49a1-904f-546bb392ebec
dotnet run --project tests/Caiwu.Payroll.Tests/ReopenProbe --no-build -- read /tmp/new.payroll.sqlite 41eed7d1-b9e1-49a1-904f-546bb392ebec
```

Windows 新实现合成窗口探针入口：`tests/Caiwu.Payroll.Tests/WindowsSmoke/run.ps1 -OutputDirectory <NEW-DIR>`。程序通过真实 WPF handler 保存部门/人员、提交最后编辑格、计算工资和生成计划，重开检查，输出 144 DPI PNG 与 source SHA/环境 JSON。需要 Windows 桌面会话；Linux 交叉编译不代表它已经运行，更不代表原版 UI 对照通过。当前实际命令结果见测试目录的 VALIDATION.md。
