# regimes：制度与民非可写账务切片交接

2026-10-26（UTC）；独立 checkout `caiwu-regimes`，分支 `codex/parity-regimes-20261026`。
基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`。本文件先行提交；实现、精确验证 SHA 和证据随后追加。

## 所有权与当前边界

独占 `src/Caiwu.Nonprofit`、`src/Caiwu.Nonprofit.Reporting`、`tests/Caiwu.Nonprofit.Tests` 及 `src/Caiwu.Reporting/SmallBusinessStatement*`、`tests/Caiwu.Reporting.Tests/SmallBusinessStatementTests.cs`。不修改公共 Contracts/Core/Persistence/TemplateCatalog、Desktop/MainWindow、solution、props 或 workflow。未找到适用 AGENTS.md；已读取工程交接技能、现存 `.ai-handoff/STATE.md`，以本轮代码与新验证为准。

底层替换已获用户授权；PR38 暂不切换实现的旧前提不再适用。参考 PR38 `3ba29a0444893ef63e2195cb031bd0dcc1d4667b` 的工程边界、PR39 原数据兼容分析与 PR40 UI 契约。使用现存 original-analysis README、gap-analysis、minfeiqi/main 的窗口/规则、tables/windows/menus/datawindows JSON；不重复解析安装包，不运行原程序，不接触真实账套，不上传原始资源或完整派生资料。

## 第一切片与拟交付 API

- 五个优先原制度条目 a01/a02/a05/a52/a54 的名称/顺序/编码结构对照；区分原模板元数据、既有官方规则科目与未取得的原科目/报表内容。44项原验收保留，不把5项或56科目快照称为44模板完成。
- 模块自有 DTO/持久化适配：民非账套、稳定凭证/分录 ID、限定类别和证据、普通活动/结转角色、外币/数量/辅助维度及原字段保留。写入同一原子账簿事务，禁止先写主账后补分类。
- 保存草稿→异人审核→过账→损益结转→月结，及反审核/反过账/反结账；真实写入与重开回读，乐观并发与账套身份检查。无权绕开现有 Core 写禁令；独立 DTO/store 先完成，再由公共核心 owner 注册。
- 已记账数据直接接既有民非两表计算，不能用只读预览代替账务能力；不把计算结果当法定完整财报验收。

所属原窗口：`w_xt_kgzb_a2/a3` 制度/科目设定，`w_xt_kmwh/w_xt_ye` 科目/期初，`w_pz_pzedit/u_pzsave/u_pzclock`，`w_zw_jz/w_zw_fgz/w_zw_fz/w_zw_qxfz/w_zw_ydjz`，`w_bb_main` 报表管理。本切片不猜 DataWindow 未知列坐标、不另造工作台。新增 UI 如有，限制在模块 Wpf 目录。

## 给公共核心集成者的精确缺口（先读）

1. 原 `pz` 至少要保留：`nf/yf/pzlx/pzbh/pz_xh/kmbm/pz_zy/pz_jf/pz_df/pz_wb/pz_hl/pz_sl/pz_dj/jslb/pz_ph/jzbz/xmbm/dwbm/bmbm/grbm/bz`，以及同表后续现金项目/合同/到期字段；按原数据声明和原值保存，不把 double/float/quantity/rate 一律转整数分。稳定行 ID 应落盘，原复合键另留。
2. 原 `pzdj` 制单/审核/记账人和日期及附单/标志、`kmbm` 银行/复币/数量/项目/客供/部门/个人/往来/现金流量标志不可丢。当前 Contracts VoucherLine 只有4字段，Account与BookInfo同样不足。
3. 凭证与民非分类/限制版本/组成/业务角色/来源凭证关联须在同一个 revision 的事务中保存、备份和恢复。不可把可变 sidecar 序号定位当永久行 ID。
4. 注册建议：以原模板ID与变体为键，不按单一 AccountingRegime 覆盖 a01/a02 或 a05/a52；原名称与显示序号独立保存，停用模板保留历史。a54 不能直接指向 `nonprofit-2026-experimental` 并宣称保真。
5. 原账套导入依 PR39 全量字段与物理依赖核对；本切片不把自有合成文件当 SQL Anywhere 兼容。tables.json 的代表变体 templates 不能推断 a54 全 schema。

## 当前状态与未实现验收

当前实现未提交，未运行本轮测试；无 Windows 实机验收。
未实现项持续保留：44完整原模板/科目/报表公式与格式恢复、全部辅助核算账簿、外币重估、数量成本、自动凭证全部规则、年结/跨年反结删除年初的原语义、现金流量表/附注、原 SQL Anywhere 导入、主桌面接线与 Windows 原生完整流程。现存 gap-analysis 所有项目仍有效；没有删除或缩小原验收。
