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

## 可编译实现检查点（2026-10-26 00:06 UTC）

实际新增 `Caiwu.Nonprofit.Writable.NonprofitLedgerService` 与 `INonprofitLedgerStore`、必需的 `INonprofitAuthorizer`。API：Initialize、SaveAccount、SetOpening、SaveDraft/DeleteDraft、Review/CancelReview、PostMonth（返回已过账/跳过未审ID）、ReversePost、GenerateClosingDraft、CloseMonth/ReopenLastMonth、显式确认影响后 RenumberMonth、GetBalances。所有变更使用 `NonprofitMutationContext(BookId, Revision)` CAS；稳定 operator ID 异人审核；没有默认放权实现。

`AtomicNonprofitLedgerStore` 是独立 `.np-ledger.json` 参考/合成持久化适配，**尚未与公共总账原子接通**，绝不是 SQL Anywhere/`.caiwu` 驱动。字段、维度、证据、凭证和审计同文件原子替换；拒绝 `.db/.caiwu`、旧版本、错账套、未知JSON成员/重复键/损坏校验和。JSON不是正式产品第二账簿。

`WritableNonprofitStatementDataSource` 从实际已记账新DTO读取两表，限定分类与稳定行ID不再靠 sidecar 序号补猜；完整 enriched snapshot hash 绑定复核。基础余额不能手填覆盖；受托/到期/减值/年初与完整覆盖须明确复核。结转前后普通活动发生额不变；按两类净资产差额作累计勾稽。未结转、分类净额相抵、缺分析或旧复核都不冒称完成。

模块WPF项目 `src/Caiwu.Nonprofit/Wpf/Caiwu.Nonprofit.Wpf.csproj` 提供真实 `NonprofitPostingWindow`→PostMonth；采用 `w_zw_jz` 已知PBU比例，年份/月份在上、确定在取消左侧，错误留窗与旧token拒绝。未声称 PBU 到像素转换、原关闭行为或 Windows 实机一致性。shell真实入口：`minfeiqi/main` / `w_zw_jz` / `menu:m_frame_zw/m_o/m_o10/m_o10_30`。其他窗口尚仅领域API，没有伪按钮。

已实跑（Linux，SDK10.0.403，`CAIWU_DOTNET_ROOT=/workspace/caiwu-dotnet bash tools/dotnet-local.sh`）：Nonprofit.Tests **90通过**（原77＋新13）；Reporting.Tests **60通过**（原55＋新5）；Nonprofit.Wpf 交叉构建0警告0错误，均启用TreatWarningsAsErrors。合成手算：期初银行/非限定净资产1000；U/R捐赠100/200，费用20/50；记账/结转后银行1230，U/R净资产1080/150，活动净增80/150；两表勾稽通过。测试还覆盖负收入结转、金额溢出原子回滚、原字段高精度维度回读、异人审核、权限/CAS/文件锁、号码断号与明确重排、反向状态链。测试只证明这些有限行为，不替代原账套兼容和全原功能。

### 对 PR52 契约检查点的反馈与接续

已读 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 ParityModules.cs/integration.md。下一检查点将在独占 Parity 子项目中以 `ModuleLedgerSnapshot`、`SaveModuleDocuments`、`AcceptVoucherProposal` 接受新草稿，把完整分录维度、原字段和分类作为同事务权威模块文档；不能把上面的外部JSON适配称为总账一致。基线Contracts没有新API，因此在独立临时契约checkout编译验证，不改本分支共享Contracts。

公共缺口：

- 原期初按限定类别/限制/辅助维度拆分，需要与 Account.OpeningDebit/Credit 同次保存；现 SaveModuleDocuments 不更改期初。科目flags/原值与公共科目编辑亦需同revision原子更新。
- 主凭证编辑保存既有草稿时，必须同事务更新/保留稳定line ID、维度、分类和原字段；AcceptVoucherProposal仅新建，旧 ILedgerService.SaveDraft不能安全更新完整内容。建议新增 `SaveEnrichedVoucherDraft` 或接受已有voucher ID的模块事务，不允许4字段编辑后分类静默失效。
- Review/Post/CancelReview/ReversePost/Close/Reopen 应保留模块文档，禁止生成新行ID或丢原值；权限按真实会话与原菜单授权，不将actor显示名当稳定ID。
- 模块报表需要同次读取账簿与民非文档；能否把全部不含基础金额的分类/到期分析与复核作为模块文档统一备份，避免外置JSON成为权威。

仍未实现：受限复币/数量损益的自动结转（有据拒绝，不猜方向）；所得税自动结转/转类/3201前期调整的独立审批；跨年、SQL Anywhere原账套无损导入、完整44模板内容、主桌面可写接线及Windows实机。普通手工合成凭证可保留复币/数量全部精度与辅助信息，但这不代表全部原外币/数量业务规则已经实现。

## 同账套桥接检查点（PR52 冻结契约）

第一实现提交 `6aa963f4ada1ab373ca3b08a2b489fe7e3c1b641`已推私有PR48。新增独占 `src/Caiwu.Nonprofit/Parity` 项目及 `tests/Caiwu.Nonprofit.Tests/Parity`，基线领域/报表/WPF项目仍独立可构建；Parity项目需公共契约PR52（未拣选到本分支共享文件）。

实际API `NonprofitParityAdapter`：RegisterBookDefinition、ConfirmOpeningClassification、AcceptDraft、ReadAcceptedVouchers、ReviewAccepted、CancelReviewAccepted、PostAccepted、DeleteAcceptedDraft、ReadWritableSnapshot、Registration。默认要求同一host同时实现 IParityLedgerService/ILedgerService；缺宿主不能悄悄退回独立JSON。模块ID `regimes.nonprofit.v1`。完整文档、来源认领与公共新草稿通过一次 AcceptVoucherProposal 事务提交；没有外部权威JSON。基础投影不丢掉完整文档中的原列、未知列、限定分类、稳定ID和所有精度维度。文档/实际凭证不符、未分类公共凭证、未知文档版本、缺真正Review/Post时间或已变期初均明确失败。

仅对“已经保存”的公共科目/期初添加一致的完整元数据/分类；不能据此说新账初始化或期初编辑已同事务接通。原窗口注册引用 minfeiqi/main 的 w_zw_jz 与 w_zw_ydjz 真实菜单路径；w_pz_pzedit 开窗入口已知静态资料为空，标为 unknown，不编造菜单。

独立临时契约checkout `/tmp/caiwu-regimes-contracts` 固定 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`。Parity Release/最终TRX另记；当前Debug对冻结契约0警告0错误，7个适配器合成宿主测试通过，验证同次投影/文档、原字段精度、旧token/提交失败、已删来源认领、增强草稿失配、高版本/重复键拒绝、权限、真实审计来源缺失。**没有把合成ContractHost当作真实Core/SQLite实现。**

给integration下一步：注册这两个独占项目（Nonprofit.Wpf、Nonprofit.Parity）与已有Nonprofit.Reporting；正式读写使用Parity而不是AtomicNonprofitLedgerStore。普通Core Review/Post必须保留全部模块文档和收据，动作审计沿既有 `Review`/`Post` 与稳定VoucherId。新开民非账套需由books/integration在科目/期初写入的同事务初始化book-definition/opening-classification；已有草稿增强编辑、月度批量/反向操作的公共API仍待ledger/integration统一，不在本模块绕过公共权限或直接写SQLite。
