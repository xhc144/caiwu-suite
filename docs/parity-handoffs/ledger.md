# ledger 原版保真切片交接

状态：in-progress；2026-10-26 UTC。工作区 `/workspace/caiwu-ledger`，独占分支 `codex/parity-ledger-20261026`，基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。这是早期交接，尚无实现或测试通过声明；最新完整 SHA 由本分支 Git HEAD 查得，最终证据将在本文件追加。

## 文件所有权

本任务只新增 `src/Caiwu.AccountingExtensions/**`、`tests/Caiwu.AccountingExtensions.Tests/**` 和本文件。不改 Contracts、Core、Persistence.Sqlite、Desktop、solution、公共 props 或 workflow。没有修改默认 book-project。没有安装包解析、原程序运行、真实账套访问或原资源上传。

## 原窗口与已读证据

- 三产品 `w_zw_fgz`：系统管理 → 反过账；年度、全年选项、起止月份，确定在取消左侧；禁止已结账月份反过账。涉及原 `cn_mx/hz/pz/pzdj/wlxx/xt`。
- 三产品 `w_zw_qxfz`：系统管理 → 反结账；最近结账期及全年选项，确定在取消左侧；不能早于开账日期。跨年年初数删除必须有来源标记及确认，不能把当前开账余额清零。
- 三产品 `w_zw_ydjz` → `w_zw_ydjz_1`：账务处理 → 月度结转；已结账期、未过账凭证禁止生成。轻松/成本明细有两张表，民非不同，不合并猜测。结转配置 `jzlx` 支持顺序、比例、转出类型等，第一切片只实现明确配置的全额损益结转计划，其他配置继续列为未实现。
- 已直接读取 original-analysis README、gap-analysis、qingsong/main README/menus/windows/zw、pzedit，及三产品 windows.json、tables.json；PR38 工程、PR39 数据兼容、PR40 UI 契约成果已读取。PR38 暂不更换底层前提已被本轮授权取代。简表的变体/未知属性不等于可丢字段。

## 拟交付 API（以最终源码为准）

1. 模块自有 `AccountingExtensionService`：绑定真实操作员会话、store 和原 snapshot/revision；反过账按区间/全年从 Posted 回到 Reviewed（保留独立审核人），反结账只撤销同年度最近期或全部已结期。一次 CAS Write 同时变更状态、revision 和审计，不重试。
2. 月度全额损益结转 `MonthlyTransferPlanner`：明确 source/target 科目，按已过账余额生成平衡草稿计划，返回原 token；通过现有 `ILedgerService.SaveDraft` 执行。不自动审核或过账；不能将扩展字段静默压成四字段 VoucherLine。
3. 自有辅助/外币/数量/原字段 DTO 及拒绝丢字段的 legacy 适配器。扩展持久化另由核心集成者统一处理。
4. 可实现的窗口放本模块 `Wpf/`；任何按钮只绑定真实行为，未支持项不放假按钮。原坐标证据已知项保留相对布局，不猜 PBU 到像素的固定倍率。

## 核心集成精确需求

核心集成线程：`01a1757c-3fa8-76aa-a1d6-9e3aa4858034`。

- 为凭证分录增加稳定 LineId；科目增加银行/复币/数量/辅助/现金流标志。分录需保留 `pz_wb/pz_hl/pz_sl/pz_dj/jslb/pz_ph/jzbz/xmbm/dwbm/bmbm/grbm/bz/dw/pzdj_bz` 及未识别原列，null 与 0 不能混同；原表变体需按具体模板核对。
- 原 `nc/xmnc/dwnc/bmnc/grnc` 保留本币/原币/数量、账前年初发生额、年度及维度。跨年结账应保存每份自动生成的年初数的来源年、来源 revision、生成批次，反结账只能在同一事务撤销对应自动生成项，不能删除人工期初。当前 BookInfo 单年模型不能执行跨年反结账。
- 反过账不是只改 pzdj 状态：原账套适配必须在同一事务回滚 `hz/slz/wlxx/cn_mx` 对应派生关系、清除过账人/时间并保留审核人/时间，确认受影响凭证清单；所有维度金额守恒。当前简化 SQLite 从 Posted 动态算账，不声称覆盖原表。
- 新权限应有独立 `ReversePost`、`ReopenPeriod`、`GenerateMonthlyTransfer`，映射原 b_rights 菜单权。现有权限只有 PostVoucher/ClosePeriod/PrepareVoucher，模块将采用保守会话守卫，不以 UI 姓名参数授权。
- 月度结转批次持久化需要唯一 `(book,year,month,rule-set,source-revision)` 标识、凭证关联、规则版本与原始结转标记；删除/反过账/重生成须同一事务。不得用外部 sidecar 与 ledger 两次写入假装原子。
- 持久化扩展和账务状态必须共用 revision、事务及备份/恢复；未知列和数值精度不可丢失。SQL Anywhere 兼容尚未实现，不能将 `.caiwu` 切片称为原账套兼容。

## 未实现验收项（保留）

原账套 SQL Anywhere 读写/模板变体；跨年年结、反结账与自动年初数；原过账派生表回滚及出纳勾账联动；独立原菜单权限；辅助/外币/数量实际持久化与凭证编辑 UI；原结转类型/比例/多规则顺序及自动重生成；断号检测重排；原全系列账簿与余额；Windows 原生 UI、键盘、DPI、三产品逐窗口对照。合成业务测试和 WPF 交叉编译不替代这些验收。
