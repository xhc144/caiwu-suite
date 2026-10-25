# inventory：原版出入库与成本核算切片交接

状态：2026-10-26，开发中；基线 main `3b0c59b02d8941c32ac176309555c03c94bb4213`。
分支：`codex/parity-inventory-20261026`。独立 checkout：`/workspace/caiwu-inventory`。
当前 SHA（早期交接前）：`3b0c59b02d8941c32ac176309555c03c94bb4213`；后续以本分支 HEAD 为准。

## 所有权与来源

仅修改 `src/Caiwu.Costing/**`、新 `tests/Caiwu.Costing.Tests/**` 和本交接。
不修改 Contracts、Core、Persistence.Sqlite、Desktop/MainWindow、解决方案、公共 props、工作流。
已检查仓库与上级目录，未发现适用 AGENTS.md；已读取 engineering-handoff-memory 技能。
直接使用 original-analysis README、gap-analysis、chengben/main 的 cb/ck 窗口、menus/rules/navigation、data/tables、相关 JSON，以及 PR38/39/40 的工程、数据、UI 成果；不重新解析安装包。
PR38 的“暂不切换实现”已被新授权取代。PR39 的字段/模板变体与副本验收限制、PR40 的相对布局/unknown 原则继续采用。

## 垂直切片与 API 计划

新命名空间 `Caiwu.Costing.Parity`，使用本模块 DTO，保留旧 API 兼容性。
- `InventoryBook`：产品 cpda、仓库/车间键、期初、单据 pjnr1/2、盘点、月度核算结果、独立 revision。
- `InventoryWorkflow`：产品维护、单据保存/删除/审核、月末加权平均核算、取消核算、当前库存查询。
- `InventoryVoucherPlanner`：入库、销售收入、出库成本、盘盈盘亏的平衡凭证计划；不自行记账。
- Wpf 模块按 `w_cb_hz` / `w_cb_fgz` / `w_cb_ckxz` 的已知 PBU 比例和原事件实现真实操作；不猜 DataWindow 内未知坐标。

对应原窗口：`w_cb_cpda`、`w_cb_ckxz`、`w_cb_qc`、`w_ck_rk/rk1`、`w_ck_ck/ck1`、`w_ck_kc`、`w_cb_pdk_1`、`w_cb_hz`、`w_cb_fgz`、`w_cb_pz`。
当前旧 `InventoryCosting` 固定移动加权、人工 CostWorksheet 路线不能作为原版完成。本切片走出入库单据与月末加权。

## 给公共核心集成者的精确接口要求

1. 原账套适配器按 `(product, template/schema fingerprint, ledger/owner)` 读取 cpda、pjnr1/2、pdk、kcb、cb_hzk、xt 的完整原始行；保留 NULL、原声明、double 原值表示、尾空格、重复行以及变体字段，不能先压进当前简化 SQLite schema。
2. 模块的原始行扩展袋须随聚合保留；这只避免模块内编辑丢字段，不代表已实现原格式读取。显式规范化业务投影与 raw 行的差异需生成可审阅补丁，不覆盖原始袋。
3. 持久化需 `Load(ledger)`、`TryCommit(expectedRevision, aggregate, audit)` 的单事务 CAS；原单据键与新增模块业务 ID 分开，禁止擅自给原表加唯一约束/去重。月核算与期间锁、取消核算须原子提交。
4. 总账对接需查询启用末级科目，按 `(ledger, documentId, voucherKind)` 去重；只写草稿；凭证关联状态（草稿/审核/过账）与单据、核算取消的冲突检查须在同事务内完成。计划失效后禁止提交旧 revision。
5. Desktop 由集成者在 `m_frame_cb` 原菜单路径注册模块窗口和 MDI 归属。不能继续把人工工作表当作“成本核算”。新 UI 组件只在本模块 Wpf。

## 验证与剩余验收

早期交接：尚未写完业务，尚无本轮构建/测试通过证据。SDK 正在安装到独立工具目录。
Linux 合成业务测试与 Windows 原生 UI/账套验收分开记录；本轮不运行原程序、不碰真实账套。
保留未实现清单：采购合同复制/综合查询、原打印格式/特殊打印、导入导出、生产成本分配/完工入库、调拨/退货、跨期结转、原始全变体映射、权限/审计及总账事务集成、Windows 真实相对布局/键盘/MDI、原账套副本兼容。上述不能从最终总体验收中删除。
月末加权的具体尾差/零库存调整细节，既有摘要不能完全确定；实现选择须单列，不能标为原版实测等价。
