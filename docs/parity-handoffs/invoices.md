# invoices HANDOFF（早期接口约定）

- 分支：`codex/parity-invoices-20261026`；基线/当前已核 SHA：`3b0c59b02d8941c32ac176309555c03c94bb4213`。本文件首次提交后以 `git log` 为准，最终验证会补在下方。
- 独占：`src/Caiwu.Invoicing/**`、`tests/Caiwu.Invoicing.Tests/**`、本文件。没有修改共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow、解决方案、props 或工作流。
- 范围：进销项单据录入/规范化导入去重/状态保护/票账比对/凭证生成计划与合成总账提交闭环；不是发票全模块完成，不做税务联网或合规认证。
- 原窗口：`w_fp_lr_1`/`w_fp_lr_2`（`m_fp_work_lr`）、`w_fp_pz`（预览生成与转到总帐分离）、`w_fp_zzs_hz`（按月/季对照）。新 UI 只在模块 `Wpf/`，使用已知控件关系，DataWindow 列序/未知运行时状态不猜。

## 首切片 API（实现中，完成后核对）

`InvoiceService` 使用本模块 `IInvoiceStore`；`InvoiceWorkspace` 带 BookId、Product、开账月/当前未结月、Revision。进销项文档保留逐行原字段 `LegacyInvoiceRow`，不会投影成共享简化 DTO。拟提供 `Import`、`Save`、`Delete`、`SetReviewed`、`CreateVoucherPlan`、`CommitVoucherPlan`、`CompareVat`。凭证计划保存源 ID/修订与科目映射快照；提交再次校验，原子写入合成总账和 `p_*` 回链，不把计划当成已入账。

## 公共核心的精确接入要求

1. 原 `g_fp_mx` 主要变体 33 列、`g_fp_mx_2` 21 列，分别还有 4/3 个变体。适配器必须携带原表名、完整列名/空值/类型/行序及未知扩展列；不得只写金额/税额/号码后丢其他列。`yhzh/dzdh/djh/bz1/sh_bz` 存在导入格式和方向相关的重载语义，不能统一改名后丢原值。
2. 账套隔离键需包含原账套稳定标识及产品。保留轻松/成本产品上下文；发票包同名窗口相同不等于可抹去成本库和出库单联动差异。民非没有发票入口。
3. 原子事务：检查源修订、未结账期间、已有凭证/审核状态 → 验证明细科目与借贷 → 分配未占用凭证号 → 写 `pz/pzdj/pz_fj` 等完整凭证 → 同事务更新发票 `pz_bz/p_nf/p_yf/p_pzlx/p_pzbh`。失败不得先打已生成标志；多张发票共同凭证的回链必须一起删除/撤销。
4. 比对需按会计期间提供总账实际分录与科目/借贷方向，不可拿生成计划当账面。销项贷方净额、进项借方净额分别与票面比较；外部账面缺失时输出“未提供账面”，不能输出匹配。
5. 集成需要源修订/CAS、科目是否存在/启用/明细、凭证审核和过账状态、期间锁、原凭证编号规则、客户/供应商及辅助核算等接口。此模块不直接改公共核心；由线程 `01a1757c-3fa8-76aa-a1d6-9e3aa4858034` 集成者提供事务适配器。

## 保留验收与未实现项

- 真实 SQL Anywhere 读写、全部原表变体、原格式导入文件解析、数据库日志/回滚与原版复开：未测试，不能称兼容已完成。
- `w_fp_get_xz` 专/普票选择、旧税控多格式导入、试用日期限制、原权限及授权策略：保持待验。
- `w_fp_pz_xz` → `w_fp_pz_ckd` 出库单生成、成本结转、库存和销售服务收入差异、自动新建往来明细科目、全部重新生成、季度凭证：保留待实现，不用简化凭证替代。
- `w_fp_fz`/`w_fp_fjz` 结账/反结账、`w_fp_xtcsh` 初始化、参数设置两窗口、客户/供应商/发票汇总、综合查询、打印/预览/另存、隐藏与历史窗口：仍在验收清单。
- 原版 Windows/UIA、DPI/字体/PBU/焦点/菜单切换、MDI/独立进程与快捷键：未测试。Linux 编译、合成断言只证明本切片实现，不证明原版行为等价。

## 已读取证据

`docs/original-analysis/README.md`、`gap-analysis.md`、两产品 `fp/README.md`、`windows/fp.md`、`menus.md`、`rules.md`、`json/windows.json/menus.json/datawindows.json/tables.json/summary.json` 的相关条目及 `data/tables.md`。PR #38/#39/#40 的说明与工程/数据/UI 文档已读；#38 的“不切换底层”旧前提已被本轮用户授权取代。未重解包、未执行原程序、未接触真实账套、未上传原资源或完整派生资料。

## 验证状态

早期阶段：实现/编译/测试尚未完成；环境缺 .NET，正在在独立工具目录安装仓库指定 SDK 10.0.402。未更改 book-project。
