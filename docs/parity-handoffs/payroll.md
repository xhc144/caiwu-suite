# 工资模块交接（第一垂直切片）

状态：2026-10-26 开工检查点；实现和测试尚未完成。独占分支 `codex/parity-payroll-20261026`，基线/current SHA `3b0c59b02d8941c32ac176309555c03c94bb4213`。仅拥有 `src/Caiwu.Payroll/**`、`tests/Caiwu.Payroll.Tests/**` 和本文件；不改 Contracts/Core/Persistence.Sqlite/Desktop/解决方案/公共构建及工作流。独立 checkout `/workspace/caiwu-payroll`。

## 已核证据

已读 original-analysis 的 README、gap-analysis、民非/成本工资窗口、工资菜单、相关 xt/pz 窗口、data/tables、windows/datawindows/tables JSON；已读取 PR38/39/40 的既有工程、兼容及 UI 契约。PR38“暂不切换底层”的旧前提已被用户明确授权替换底层所取代。静态定点比较：两产品以下窗口的 props/controls/events 相同；不代表原版实机行为全部相同。

所属原窗口：`w_gz_bmwh` 部门维护、`w_gz_rsgl` 人事管理、`w_gz_rsgl_ins` 增加员工、`w_xt_gzsz` 栏目定义、`w_xt_gssz / w_xt_gs_edit` 公式定义、`w_gz_gzgl` 工资管理、`w_gz_edit_set` 统一置数、`w_pz_sz / w_pz_build_gz` 凭证设置/生成。保留名称、入口与有证据的相对布局；DataWindow 内部布局、动态工具栏排序仍 unknown，不猜坐标。

## 计划 API（以最终代码为准）

- 模块 DTO：部门、员工及原 `g_j4..8 / g_f1..2` 扩展、可定义栏目及打印/传递属性、公式及条件/执行/计税标志、工资期间与行快照、税参数来源、工资表、凭证计划。
- `SqlitePayrollStore.CreateNew/Open`：模块专属合成工作文件，独立身份和版本标记；事务提交和 revision 冲突检测。不是原账套导入或替代格式。
- `PayrollService`：部门/人员/栏目/公式持久化、月工资输入与统一置数、依赖排序计算、工资表及凭证计划保存重开。
- `Wpf` 独立 csproj：按所属原窗口建立有真实事件处理的窗口，待集成者注入模块 service。

## 给公共核心集成者的精确建议

1. 需要按 BookId 隔离且带 revision 的模块事务、备份/恢复参与接口，保留所有扩展原始值及 NULL；禁止压缩成现有工资汇总或少量 DTO。`gz_gzk` 主流定义有 92 字段（含 80 金额栏）且有 2 变体；`gz_gsk` 3 变体、`gz_yfkm` 2 变体，完整变体映射仍需兼容 owner 处理。不能擅自去重、截短、改原精度/字符语义。
2. 凭证导入需要原始业务来源 ID、工资期间/计划 ID、幂等键、BookId/revision 校验、科目有效且为明细及辅助维度验证、重复已审/记账拒绝；事务中回传凭证 ID/状态。当前模块先产出并持久化计划，不能将它称为已转总账；不要直接丢进简化 VoucherLine 丢部门/人员等维度。
3. 主壳保留 `m_frame_gz` / `m_work_gzgl` / `m_work_rsgl` 菜单和 MDI 关系；激活窗口注入原操作菜单。公共权限、账套身份、业务日期与模块工作文件路径由集成者提供，不在模块复制认证或改 MainWindow。
4. 原账套读取采用兼容 owner 的只读适配器；本模块不打开 SQL Anywhere，不把独立合成 SQLite 叫原账套兼容。

## 未实现/待验（不移除验收）

当前全部实现待交付。最终仍须逐项登记：完整 PB 公式/日期函数/条件语义、税年度累计与特殊人群、工资条/汇总/累计汇总/票面/套打、综合查询、结账/反结账、初始化、原账套全部变体无损读写、转总账和审核记账约束、主壳权限/MDI、真实 Windows 操作及原版逐窗口对照。构建和合成测试不证明这些通过。

未重解析安装包、运行原程序、接触真实账套或上传原资源/新的完整派生资料。未发现适用 AGENTS.md；按工程交接技能记录实际证据，无 Handoff Memory MCP 可用。
