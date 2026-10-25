# Reports parity handoff

2026-10-26 UTC。独占分支 `codex/parity-reports-20261026`；起点/当前代码基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。独立 checkout `/workspace/caiwu-reports`；未修改默认 book-project。

## Ownership / integration

只改 `src/Caiwu.ReportDesigner/**`、`tests/Caiwu.ReportDesigner.Tests/**` 和本文；共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow/solution/props/workflows 均由集成者拥有。本模块继续复用原有有界精确算术，不把旧列公式设计器当作原版完成。

计划新增 `Caiwu.ReportDesigner.Cells`：二维稀疏单元格、行高（英寸）、列宽（字符）、单元格格式、安全公式/单元格依赖、报表取数源接口、原子保存读回、HTML/CSV 导出。公共 API 以本模块 DTO 为界，不等待简化 Core。

原窗口归属：`w_bb_def`/`m_bb_def`（u_save/u_open/u_proc/u_proc_1/u_help/u_formu/u_grid）；`w_bb_def_rowh`/u_rowh、`w_bb_def_colw`/u_colw、`w_bb_def_format`/u_format、`w_bb_def_help`、`w_bb_proc`。新增 WPF 放模块 Wpf/Cells；保留已知相对布局，未知 ole_1.x 不猜。

## Evidence already read

main 的 original-analysis README/gap-analysis、三个产品 windows.json 中报表对象、qingsong windows/bb.md 与 m_bb_def 菜单、相关 tables.json/tables.md 与 d_bbml/dw_bb_help DataWindow；PR38@3ba29a0、PR39@11a8d77、PR40@8de73d5 的已有工程/数据/UI成果。PR38 等待 PB 工程/不切换实现的旧前提已被用户替换底层授权取代。

原设计最大 999 行/250 列；行高英寸、列宽字符。原函数清单数据来自 dba.bbfun（bz/mc/xh），本次资料只有 schema/查询，没有记录和完整函数语义；不能把自建函数名字当作原函数语法。原 ole 控件字节/VTS 与数据库 dba 载荷尚未解码，不能宣称已可打开原报表文件。

## Integration contract required (precise proposal)

1. 提供一次捕获的只读账套快照，含账套 id、会计制度/版本、generation/revision、完整期间、是否合成、币种、科目真实父子关系、各维度期初借贷、已过账/未过账状态和发生日期；取数过程必须固定同一代，禁止切账混入。缺字段必须拒绝/报告 missing，不能补零或丢弃。
2. 保留原 bbml 的 xh/bbname/row/col/bz1/bz2 和完整原 VTS/dba 数据为受管原始附件；本切片 JSON 是新版设计格式，不能覆盖原件或当作原文件转换器。将新模板登记到账套备份附件/事务中，受管路径由集成者统一提供。
3. 提供 bbfun 的经过核验的函数名/编号、参数顺序、币种/项目/部门/客户/个人过滤、未过账处理/舍入与跨账套规则。适配器可调用本模块查询接口，但未知函数必须报错，不按名字猜。
4. 接入原 `w_bb_main` 的定义入口，不替换成旧 ReportCenter；MDI、账套权限、原版菜单完整性、保存退出拦截、Windows 实机观察由集成者协调。

## Current status

early-handoff：实现/测试尚未完成，未有新功能通过证据。最终提交会补齐命令、SHA、结果与未实现清单；该早期提交本身不是产品完成。

## Acceptance retained (not removed)

原报表管理/增加/删除/复制/引入/转出；原账套与 VTS/DB 报表读写；全部 bbfun/跨报表/辅助维度/外币/数量/多账套函数；插删行列及引用重写、边框字体/合并跨列/绘线、分页/打印标题/真实打印、报税接口、完整函数向导；三产品差异；所有原窗口/菜单与权限、Windows 原生交互与视觉回归。首片外全部待实现/待验，不能用编译或合成测试数量替代。
