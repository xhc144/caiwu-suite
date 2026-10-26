# payroll — 原版工资流程第一垂直切片

2026-10-26 UTC；私有 [PR50](https://github.com/xhc144/caiwu-suite/pull/50)，独占分支 `codex/parity-payroll-20261026`，独立 checkout `/workspace/caiwu-payroll`。基线 `main@3b0c59b02d8941c32ac176309555c03c94bb4213`。

**可供集成的业务源码 SHA：`dbf6bd271f7d8a1dba4917463e3a70882fe3b98f`。** 后续只补本 handoff 和测试证据文档。早期 handoff `f3385e4dd295c1a6b0023b68cbb98047ed747d16` 已先推送；业务首片 `1418484`、UI/adapter `08cba22`，确认绑定修复 `dbf6bd2`。按父任务最新要求只收尾此切片，不追加功能、派工或改技术栈。

这是有限切片，不能把构建、测试数量或旧 0.1.0.4 当作原版全功能完成。

## 文件所有权和证据

仅编辑 `src/Caiwu.Payroll/**`、`tests/Caiwu.Payroll.Tests/**` 和本文件。未改共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow、解决方案、公共 props、工作流、其他模块或默认 book-project。未合 main、公开、改变权限、购买额度、运行原程序/安装器、触碰真实账套、上传原资源或新的完整派生分析。

已读 original-analysis README/gap-analysis、民非工资窗口/菜单、相关 xt/pz 窗口、data/tables、windows/datawindows/tables JSON；对成本产品对应工资窗口的 props/controls/events 逐对象比较相同，不扩大为运行时等价。已读 PR38/39/40 工程/数据/UI 成果；PR38 旧“不切底层、等待 PB 工程”前提已由用户新授权覆盖。未发现适用 AGENTS.md。按工程交接技能记录真实证据，没有 Handoff Memory MCP，不伪造记录。

## 已完成业务

- 部门、人员维护与新增/停用 API；引用部门/已有工资人员不能删除。月工资保存人员/部门/属性快照，改主档不改历史。
- 原 g_j1..8、g_f1..2、g_l01..80 共90稳定槽位；名称、顺序、启用、类型、传递、宽度、小数及三类打印参数可配置。NULL、尾空格、原码和未解释字段保留，不自动截短、去重或声称原 double 已无损转换。
- 明确工资月份、可选前期输入传递；手工输入、整表单事务存盘、统一置数、空值设零。输入/配置变更使计算过期，不能用过期结果生成计划。
- 数值公式/条件解析、依赖拓扑排序、NULL传播、IF/逻辑短路、COALESCE、ROUND/MIN/MAX/ABS。循环/未知字段或函数/除零/溢出报错，整月计算失败不部分保存。
- 实际工资表/合计/CSV，工资发放和分配计划含逐人部门来源、科目校验、分位舍入、借贷检查；不猜科目或补平。计划存盘重开，与已转总账/审核/记账区分。
- 税参数配置 API 要求名称、HTTPS出处、条款/数据定位、有效期、起征额和税档。无默认现行税率；仅单期累进算术，测试税表虚构，不是法律数据/年度申报方案。
- 独立模块 SQLite 事务保存/重开、账套身份/version、revision CAS、排他新建、不覆盖未知文件。仅为独立合成切片，不是原 SQL Anywhere 兼容或总账跨库原子性。

## API 和公共集成

详细使用见 [README](../../src/Caiwu.Payroll/README.md)，定义见 [Models](../../src/Caiwu.Payroll/Models.cs)、[PayrollService](../../src/Caiwu.Payroll/PayrollService.cs)。

`IPayrollStore.Read/Commit(document,expectedRevision)` → `PayrollService` → `SaveDepartments/SaveEmployees/AddEmployee/SaveColumns/SaveFormulas/SaveTaxProfile/OpenPeriod/SetInputs/SaveInputs/SetUniformValue/Calculate/GetWageTable/SaveVoucherSettings/CreateVoucherPlan`。

已按 PR52 冻结契约 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 实现独立 [ParityPayrollStore](../../src/Caiwu.Payroll/Integration/ParityPayrollStore.cs)：

1. 构造传 IParityLedgerService、用户所见同一 ModuleLedgerSnapshot、宿主认证操作者。首次使用该快照，仅显式 Refresh 才取新 revision；不保存前刷新或冲突重试。
2. 权威状态为 ModuleId=payroll、DocumentId=payroll-state、SchemaVersion=1 的完整 JSON，经 SaveModuleDocuments 入账套事务，无外部文件投影。ExtensionData 保留未知属性/高精度数值原文；高 schema 拒绝降级。
3. 宿主显示/确认已存计划后调用 `AcceptPlan(service.Snapshot,planId)`；内容必须与该 store 最近读回/提交的文档一致，不能在克隆上删维度标志。期间数据/配置版本也须匹配。
4. 来源键固定 `payroll:{BookId}:{Gregorian yyyy-MM}:{Payment|Distribution}`，内容哈希另存；改金额/日期/编号/随机ID不能重复支付。相同内容返回同一计划，变更重复来源拒绝，原版刷新草稿流程仍未实现。
5. AcceptPlan 把模块状态、来源和新草稿放进一次 VoucherProposal；依据 ModuleVoucherReceipt 重开恢复 draft ID。当前只用**冻结接口替身**验证，未称真实公共 Core/SQLite 原子提交已接通。辅助维度或未解释计划字段不支持时拒绝转入。

Wpf [PayrollWindowFactory](../../src/Caiwu.Payroll/Wpf/PayrollWindowFactory.cs) 提供真实入口。PersonnelManagementView/WageManagementView 是 MDI UserControl，不新造首页。closeSheet 必须关闭当前 sheet，宿主关闭须调用 CanClose。月份、完整科目元数据、凭证类型、权限、真实转总账回调由宿主传入；切账重建 store/service/factory。无真实 transfer handler 时不画空转总账按钮。

## 所属原窗口与 UI

| 原对象 | 已实现的静态相对关系/行为 | 尚未确认 |
|---|---|---|
| w_gz_bmwh | 左表右列，增加/删除/存盘/退出上至下，引用校验 | 原 Tab/焦点、像素/DPI |
| w_gz_rsgl / w_gz_rsgl_ins | 人事sheet；新增上基本项、下左工资项，右侧存盘在退出上 | 完整视觉列序、改编号等原操作 |
| w_xt_gzsz | 栏目表在上、存盘在关闭左 | 原DW样式/列序 |
| w_xt_gssz / w_xt_gs_edit | 列表上、增加/删除/修改/存盘/退出左至右；编辑左/字段辅助右 | 全公式语义、其余快速选择原交互 |
| w_gz_gzgl | 工资sheet；原顺序操作菜单子集、Ctrl+S/F4；提交当前编辑格后存盘 | 动态工具栏、其余操作/焦点 |
| w_gz_edit_set | 栏目在值上、空值设零/确定/取消左至右，实际批量写入 | 返回/默认按钮精确模式 |
| w_pz_sz | 应付设置上/贷方表中/分配项下，表右增加在删除上，确定在取消左 | 完整辅助选择/科目元数据 |
| w_pz_build_gz | 发放在分配左，年月/日期/类型/编号上下，生成在退出上，参数/预览分模式 | 原模式切换、完整刷新/总账关系 |

DIP大小为候选可缩放实现，不猜 PBU→像素倍率；未伪造未知工具栏，现提供实际操作菜单。DW内部视觉列序、动态工具栏图标/排序、原运行时模式和焦点继续 unknown。没有原版实机截图对照。

## 给集成者的精确缺口

| 缺口 | 所需处理/当前限制 |
|---|---|
| PR52 VoucherProposal.Lines仍是旧VoucherLine | 扩展部门/人员、项目/客户、外币/汇率、数量/单价、原行号/未知列及验证。计划保留部门/人员；有必填维度或未解释计划字段时拒绝转入，不能降级 |
| ModuleLedgerSnapshot.Accounts无辅助/外币/数量要求 | 宿主须从完整扩展快照提供PayrollAccount，不能只映射IsActive/末级并把unknown当false；当前仅完整synthetic fixture，真实映射缺失 |
| 权限/注册 | Registration列真实产品/对象/入口；shell须按权限绑定真实工厂。payroll专用权限粒度待授权owner，不复制认证 |
| JSON历史规模 | 首片一个完整模块文档；正式规模应按settings/personnel/period/plan稳定ID拆文档，以batch同revision原子提交；须实测公共文档大小/深度/数量预算，当前未认证 |
| 原表全部变体 | gz_gzk92字段/2变体、gz_gsk3变体、gz_yfkm2变体，完整NULL/精度/字符集/关系由compat映射；已有保留容器但没有SQL Anywhere读写迁移，不可仅凭主要定义称兼容 |
| 真实同库验证 | 冻结接口替身不证明Core实现；应用审核SHA后跑真实CAS/失败回滚/收据重开/备份恢复、Windows主壳流程 |

## 原版未实现项（保留验收）

| 原入口/操作 | 当前状态和剩余工作 |
|---|---|
| 工资管理 | 输入/置数/计算/合计/CSV/计划可用；完整工资行新增/删除/复制、原多格式另存、定位、首/上/下/末移动及继承操作未齐 |
| 人事管理 | 新增/编辑/删除未使用人员可用；w_gz_rsgl_xg改编号、人员统一置数/定位/打印/记录移动、完整扩展编辑UI未实现 |
| 工资结构/公式 | 设置及数值依赖计算可用；原PB/SQL表达式、文本/日期条件、today/daybefore/monthbefore、重复目标有序赋值、全部快速选择未完成；保留原文报错，不设零 |
| 个税起征点/套账信息w_xt_kgzb_1_gz | 有来源配置API；原信息窗口/税参数UI、真实出处法定数据集、累计预扣/专项/特殊人员/跨年规则未实现，不冒充申报 |
| 凭证设置/生成 | 发放/分配平衡计划可重开；真实总账、必填辅助、草稿刷新、重复已审/记账保护全流程、w_gz_pz辅助选择待实现/集成 |
| 结账w_gz_jz/反结账w_gz_qxfz | 未实现，含月份锁定/初始日期边界/跨期/恢复验收 |
| 工资条/工资表打印w_gz_prt_gzb | 工资表/CSV不替代原打印；部门范围、日期、页边距、预览/缩放/打印/重选/另存、工资条未实现 |
| 工资汇总/其它汇总w_gz_prt_hzlm | 普通合计不替代原分组汇总；栏目选择/部门汇总/打印未实现 |
| 累计汇总w_gzgl_lshz | 年月范围/部门/栏目累计查询和打印未实现 |
| 票面计算w_gz_prt_pm | 面额分配/打印未实现 |
| 综合查询w_gz_zhcx | 列/过滤/排序/连接/执行/另存/打印未实现，普通表格排序不算 |
| 打印格式w_xt_dysz | 参数可保留，原格式窗口/实际宽度应用未实现 |
| 系统初始化w_xt_kgzb_gz | 原初始化/清空范围/开账/确认/事务恢复未实现，合成CreateNew不替代 |
| 工作台/主菜单/权限/子系统切换 | 归shell/公共owner，本模块不改主壳，不代表w_main1_gz三页或全m_frame_gz已验收 |
| 原账套/真实Windows保真 | 均未验；原版和真实账套本轮不运行/触碰，新截图不能替代原证据 |

## 验证、阻断、下一步

源码冻结版 Release、`-warnaserror -p:RestoreLockedMode=true`：模块合成测试35通过、冻结契约替身7通过，0失败/跳过；Wpf/WindowsSmoke交叉编译0警告/错误。两个独立进程实际落盘/重开：revision=9，实发3350.25，第80栏6700.50，计划1条，NULL/尾空格保留。见 [VALIDATION](../../tests/Caiwu.Payroll.Tests/VALIDATION.md)。

WindowsSmoke仅**已编译未执行**，会通过新实现真实handler生成144DPI PNG/source SHA JSON；当前无Windows成功结果或原版比较结果。最初NuGet runtime目录缺失已用工作区目录解决，未改系统权限/凭据。

本切片可独立构建/测试，无被拒绝或结果不明的远端写入。公共接通待PR52实际Core/SQLite及辅助字段扩展；Windows实际运行待Windows桌面环境，目前Linux只交叉编译。这些是**未执行/待验证**，不是安全拒绝后的重试。

父任务可回接至上述源码SHA；先核共同地基、按工厂及已审公共实现跑真实集成。按最新指令不追加后续模块或另派任务，未实现项继续保留。
