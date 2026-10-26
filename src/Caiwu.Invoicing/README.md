# 发票保真升级：第一垂直切片

独立于旧 0.1.0.4 的发票领域模块；基线 `main@3b0c59b02d8941c32ac176309555c03c94bb4213`。只支持原来具有发票模块的轻松、成本两产品，分别保留产品身份；没有为民非制造发票入口。依据已入库分析开发，没有重新解包或运行原程序。

此切片可以实际录入、修改、逐行删除、受保护批量删除、转入并检测重复/冲突、保存和重新打开合成工作区，生成与验证凭证计划，原子写入合成总账与发票回链，再按月/季比对。它不代表完整发票模块或原账套兼容已经完成。

## 数据和业务行为

- `LegacyInvoiceRow.Fields` 保留原字段名、JSON 标量类型、空值、时间戳原文、未知扩展列及行序。`InvoiceColumns` 覆盖原主要变体销项 33 列/进项 21 列；原还有 4/3 个变体，扩展字典用于承载尚未解释的列，不能据此声称全部变体已经验证。`lx/fpzt/sh_bz` 不按猜测重新编码。`yhzh/dzdh/djh/bz1` 的原始重载语义也保留。
- 规范化导入每个 `InvoiceImport` 是一张票：销项可含多行，须带不重复原行号 `xh`；进项原表无商品行号，只允许一条票面汇总记录。导入适配者须先按票归组，不能把重复进项汇总当多行累加。
- 账套和产品由工作区隔离；票身份为方向、专/普票、发票代码、号码。号码作为字符串保留前导零。相同内容（忽略字段/行枚举顺序）重复跳过；同票不同内容使整批回滚，不覆盖已审核/生成状态。初始导入内容和当前导出内容均可防重，生成后的再次导入不会再次入账。
- 保存检查号码、开票/认证日期和已结账界限；销项按已有提示语检查数量×单价差 `<0.01`、金额×税率差 `<0.02`。没有把缺失数字默认为凭证零值。原试用/权限规则仍待宿主提供。已审核、后续处理、未知标志、已有回链或已结账票禁止直接改删；批删除保留受保护记录并报告跳过。
- `SetReviewed` 只处理销项已知 0/1 审核标志；进项 `sh_bz` 兼有原认证方式语义，明确拒绝套用销项审核去改写。进项原值可导入、展示、保留并参与处理保护，认证方式的完整映射仍待核验。
- 计划和提交分离。计划记录账套、产品、全工作区 revision、源票、科目、逐票/按月方式和编号；提交重算校验，拒绝篡改、旧 revision、重号、非明细/停用科目、缺金额、借贷不平和不能表达的精度。销货/服务使用各自收入映射；进项税分列与否是调用方的显式参数，不推断税务身份。红字金额在凭证中反转借贷方向。
- `CommitVoucherPlanToSandbox` 只提交本模块的**合成总账**，不是生产总账接口。它与源 `pz_bz/p_nf/p_yf/p_pzlx/p_pzbh` 在一个快照 CAS 中保存；删未审未过账合成凭证同时清除所有关联票回链，不能只清一票。原 SQL Anywhere、`pz/pzdj/pz_fj` 等真实表完全未接触。
- `CompareVat` 接受显式账面分录。销项取贷−借、进项取借−贷；进项使用认证日期（无认证日时暂用开票日，待原事件完整复核），按月或季度输出票面/账面/差额。账面未提供、票面税额缺失时保持 null，不能显示匹配；票面当前汇总所有记录，未擅自推断作废等状态的税务排除规则。

`InvoiceJson` 拒绝任意层级重复键，并通过 `UnmappedMemberHandling.Disallow` 拒绝模块、单据、票键、行包装、期间、交换包等 DTO 结构层未识别成员，含值为 null 的成员；读取失败后不能继续改写并静默丢字段。原列扩展仍由 `Rows.Fields` 的 `JsonElement` 字典无损承载，空值和数值原文不经 double 转换。`SyntheticJsonInvoiceStore` 只接受显式 `.invoice-synthetic.json`，新建不覆盖、侧车排他锁、revision CAS、完整快照原子替换与独立实例读回。此文件只作独立合成切片，不能与真实总账宣称跨文件原子一致。

## 构建与合成测试

仓库指定 SDK 10.0.402；无需改解决方案或公共 props：

```sh
dotnet test tests/Caiwu.Invoicing.Tests/Caiwu.Invoicing.Tests.csproj -warnaserror
dotnet build src/Caiwu.Invoicing/Wpf/Caiwu.Invoicing.Wpf.csproj -warnaserror
```

领域测试包含事务失败/冲突不留半状态、重复/多行/红字、状态保护、回链、精度、按月/季比对、JSON 读回与跨实例 CAS；另直接读取仓库既有表/DataWindow/窗口 JSON，核对字段覆盖及两产品录入区锚点。后者只证明静态来源一致，不是原版实机对照。

Windows 合成宿主（仅新实现）可以直接操作完整切片：

```powershell
dotnet run --project src/Caiwu.Invoicing/Wpf/Caiwu.Invoicing.Wpf.csproj -- --create-synthetic C:\scratch\invoice-demo.invoice-synthetic.json Qingsong
dotnet run --project src/Caiwu.Invoicing/Wpf/Caiwu.Invoicing.Wpf.csproj -- --open-synthetic C:\scratch\invoice-demo.invoice-synthetic.json
```

`--create-synthetic` 要求新文件和已存在目录；可选 `Chengben`。它只种入虚构进销项两票和虚构科目，号码/税号明确为合成数据。可在录入页另存 `.invoice-transfer.json`，重复转入检查去重，再分别生成销项/进项（同月同类型须选择不同起始凭证号），预览后“转到总帐”，比对、关闭、重新打开、删除未审凭证，核查持久状态。

## WPF 归属和边界

`Wpf/` 包含独立可编译宿主及可嵌入 `InvoiceEntryView`、`InvoiceVatView`、`InvoicePlanWindow`。原窗口分别为 `w_fp_lr_1/2`、`w_fp_zzs_hz`、`w_fp_pz`。录入页操作菜单/工具栏顺序、Ctrl+A 增加、Ctrl+F 刷新、Ctrl+F4 返回、未存盘提示、批删除二次确认有真实处理程序；未接通动作不做假成功。

录入区 12 个控件的既有 PBU 锚点分别建模，没有拿轻松坐标覆盖进项的细微差异；渲染采用归一化相对布局，不声称 PBU 到像素/DPI 换算已经校准。DataWindow 可视列序未知，当前可编辑网格按 schema 展示，**是待原版验收的开发视图**。计划窗口保留源年月→凭证年月/类型/编号→进销项/销货服务→逐票/汇总→参数/生成/转账/取消的已知关系；参数窗口只有实际参与本切片的科目映射，当前会话生效，原完整参数持久化仍待集成。宿主不是原 MDI/独立进程壳的替代品，生产主界面没有被修改。

Windows 原生交互、焦点、DPI、原菜单显示策略、打印和原账套均未验证。完整缺项保留在 [模块交接](../../docs/parity-handoffs/invoices.md)，未通过编译或测试数量删去。

## PR52 公共接口适配

`ParityAdapter/` 是独立可选工程，依赖已公布的契约检查点 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`。基线尚没有 `ParityModules.cs`，因此默认领域/窗口构建不依赖它。核心未整合前，可将该提交放在另一个只读 checkout，明确指定工程：

```sh
dotnet test tests/Caiwu.Invoicing.Tests/ParityAdapter/Caiwu.Invoicing.ParityAdapter.Tests.csproj \
  -p:ParityContractsProject=/path/to/exact-checkpoint/src/Caiwu.Contracts/Caiwu.Contracts.csproj -warnaserror
```

- `ParityInvoiceAdapter.Read` 从同一 `ModuleLedgerSnapshot` 重建发票视图，模块文档是权威状态，不读外部 JSON；revision 来自账套，不使用独立文件 revision。
- `ParityInvoiceStore` 可供录入 `InvoiceService` 使用，`TrySave` 只用已显示快照构造 `ModuleDocumentBatch`，没有刷新 token 或自动重试。
- 生成计划用该 store 的视图。宿主通过 `OriginFor(plan.WorkspaceRevision)` 取原快照，`PrepareVoucherProposal` 显式传凭证类型映射和完整日期，再调用 `AcceptPreparedProposal`。它携带源状态变化，成功取真实 receipt 后才能显示已接收。WPF `InvoicePlanWindow` 的第三参数可注入这一处理函数；未传时仅调用合成总账。
- 当前每个公共 proposal 只允许一张新草稿：单票或月汇总可构造，多票逐票计划明确拒绝，不能偷偷拆事务/刷新 revision。手工指定编号使同事务回链可确定；原自动编号、全部重新生成、删除/冲回和释放来源认领需核心新能力。
- 稳定 SourceKey 根据产品和业务票身份生成，删后重新导入换 Guid 也不能绕过已消费来源；已有 receipt 即使草稿删除仍拒绝新建议。
- 源原列完整存于版本化 `invoices/workspace` 文档。调用者必须先验证 `VerifiedBaseCurrencyWithoutAuxiliary` 范围；遇到明确辅助/外币/凭证数量等字段则拒绝降级建议。当前公共 Account 没有数量/外币/辅助标志，仍需宿主提供真实元数据；不能凭范围枚举冒称原业务已全覆盖。

适配器验证是**契约构造/冲突行为测试**；本轮未在 PR52 Core/SQLite 实现上执行接受和重开，不称公共总账已经接通。它也不是 SQL Anywhere 适配器。
