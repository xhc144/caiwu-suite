# 出纳模块交接（早期接口，持续更新）

- 日期：2026-10-26（UTC 起始 2026-10-25 23:55）；负责人：cashier 委派任务。
- 独立 checkout：`/workspace/caiwu-cashier`；独占分支 `codex/parity-cashier-20261026`。
- 固定基线/当前实现前 SHA：`3b0c59b02d8941c32ac176309555c03c94bb4213`。
- 文件所有权：仅 `src/Caiwu.Cashier/**`、`tests/Caiwu.Cashier.Tests/**`、本文件。不修改共享 Contracts/Core/Persistence.Sqlite/Desktop、解决方案、公共 props、工作流。

## 本切片 API 与所属原窗口

独立 `net10.0` 模块，模块内部 DTO、事务存储接口和合成数据 SQLite 适配器；WPF 独立 csproj 放 `src/Caiwu.Cashier/Wpf/`，不注册公共主窗口。

| 原窗口/事件 | 拟公开入口 | 行为 |
|---|---|---|
| `w_cn_lr_qc` / 数据存盘 Ctrl+S | `CashierService.SaveOpening` | 按账套、科目、币种、年度保留期初；独立事务 |
| `w_cn_lr` / `ue_action_new,modify,del` → `w_cn_lr_add.cb_1` | `AddDocument / UpdateDocument / DeleteDocument` | 自动唯一单号，收支录入，禁止已勾账/结账/已生成凭证/其他系统转入记录直接改删 |
| `w_cn_lr`、`w_cn_slz_1` | `GetJournal` | 期初、按日期和单号的明细余额、本日小计 |
| `w_cn_dz_xz` → `w_cn_dz_ny` → `w_cn_dz` | `ReadReconciliation / Reconcile / CancelReconciliation / AutoReconcile` | 按账户/币种/年月读取；账务侧仅已过账，金额校验、组号、整组取消与事务 |
| `w_cn_pz` | `CreateVoucherPlan`（优先级次于前四项） | 逐条/本月汇总借贷平衡计划；没有公共原子过账接口前不冒充已转总账 |

## 集成者需要提供的精确接口

1. 科目目录快照：账套身份、科目码/名、是否明细、是否含现金流量选项、币种目录；原出纳账户由含现金流量科目+币种组成，不通过代码前缀猜账户。
2. 账务对账适配：稳定凭证/分录 ID、修订 token、账套/日期/科目/币种、借/贷原精度、已过账状态、原勾账码。勾销/反勾销须与出纳一事务提交或由公共协调器提供一致性边界，不能在模块缓存成功后把账务写失败吞掉。
3. 生成凭证适配：公共事务内保留逐条来源关联、凭证编号策略、期间/权限/审核状态校验、原精度；安全重试和删除已生成凭证时的联动。模块计划不直接调用旧精简 `VoucherLine` 丢外币/辅助项。
4. 原格式适配：`cn_mx` 已知至少 8 变体，主要 16 字段外，DW 明示 `g_qymc/khyh/yhzh` 等；`cn_nc` 3 变体、`cn_hz` 2 变体。需要版本化 schema 指纹、原值/NULL/未知字段及原关联完整保留。当前模块合成存储不能宣称原 SQL Anywhere 账套兼容。
5. 宿主：独立出纳子系统/MDI sheet，保留 `m_frame_cn`、窗口操作菜单、父子窗口路径、Ctrl+A/Ctrl+S/Ctrl+F4，不改成公共主窗口新流程。

## 证据与当前状态

已读取原版 README/gap-analysis、qingsong/cn 菜单/导航/窗口/规则、出纳表定义和相关 JSON；读取 PR #38/#39/#40 现有工程/数据/UI 结论。#38 旧的“暂不切换底层”已被当前用户授权取代，不作为停工条件。

- 早期状态：接口设计已记录；代码/测试尚未完成。
- 编译/合成行为：尚未执行。
- Windows UI/键盘/DPI/原版逐窗口对照：未执行。
- 原程序/安装器/真实账套：未运行/未接触；禁止上传原始资源和完整派生资料。

## 保留未实现清单

原初始化及清空确认、出纳结账/反结账及年度滚转、账务/外部转入、批量删除、综合/定位查询、摘要和科目查找、自动对方科目参数全分支、已生成凭证删除/重生成、原总账原子落地、余额调节表、汇总/外币汇总余额表、打印预览/套打/格式定义/另存、多窗口菜单/权限/登录切换、隐藏项条件行为均需独立实现与验收。当前切片不从原验收范围删除这些项目。
