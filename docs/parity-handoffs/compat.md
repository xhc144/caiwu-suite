# compat 原账套兼容切片交接

2026-10-26 00:10 UTC；独立 checkout `/workspace/caiwu-compat`；独占私有分支 `codex/parity-compat-20261026`；[草稿 PR #43](https://github.com/xhc144/caiwu-suite/pull/43)。基线 `3b0c59b02d8941c32ac176309555c03c94bb4213`；早期 HANDOFF `51bc90549c05ec202404d3cdac615ef7a3b3dcb7`；**实现/验证冻结 SHA `77102a8c86bfe273505d0bb312d9bf0778b47488`**。本文件的最终证据提交附后，分支最终 HEAD 见 PR/交接响应。

状态：只读兼容预演垂直切片 success；原 SQL Anywhere 打开/完整兼容 blocked（缺驱动与经过验证的副本会话，不是等待 PB 源工程）；公共 Core/SQLite 真实集成 pending。没有原账套成功证据。

## 所有权与原入口

仅新增 `src/Caiwu.LegacyCompatibility/**`、`tests/Caiwu.LegacyCompatibility.Tests/**` 与本文。共享 Contracts/Core/Persistence.Sqlite/Desktop/MainWindow/解决方案/props/工作流、默认 book-project 均未改。没有本 checkout 适用 AGENTS.md；已读既有 `.ai-handoff/STATE.md`，其中 0.1.0.4 验收不覆盖本次目标。

关联三产品原窗口：`w_tzjl_get` / `w_tzjl_get_all`（引入）、`w_hf`（恢复）、`w_xt_kmwh`（科目）、`w_pz_pzedit` / `w_pz_pzxsb`（凭证）、`w_xt_ye` / `w_zw_ye_1`（期初/余额）。三产品 JSON 均确认 `w_tzjl` 的 `cb_6.clicked` 打开 `w_tzjl_get`。此切片没有 UI，不猜坐标、不启用恢复/自动升级按钮，也不注册假窗口。

## 可用 API 与实质行为

- `ILegacyReadOnlyExtractor`：只读提取契约；`RelationalReaderCapture.CaptureAsync(DbDataReader, exact identity, catalogue columns, ...)` 实际捕获标准 CLR provider 值。没有连接/启动引擎/密码/写入入口。`SqlAnywhereReadOnlyExtractor` 明确抛出 `sql_anywhere_driver_and_verified_copy_session_unavailable`；合成 DataSet 适配器冻结全部值。
- `LegacySnapshot/LegacyTable/LegacyRow/LegacyCell`：保留所有表/列、声明、NULL、空串、尾空格、读取顺序、binary、日期和数值原文。schema 和内容指纹可复核；schema 指纹不含完整 DDL/索引/触发器。未知 provider 包装类型/非有限浮点数/超行预算失败，不截断表。
- `CoreMapper.Map`：必须按精确 owner/表名及实测 schema 指纹绑定五个核心表。映射科目标志/默认维度，凭证身份、原行号、状态、人员/日期、附单、摘要、外币/汇率/数量/单价、辅助/现金流量/合同/到期日，年初及账前发生额/本位币列，月度借贷和辅助/币种粒度；原完整快照始终伴随投影。
- `PreviewInterpretation`：显式期间、本位币、末级科目范围、金额/粒度/过账状态解释与证据引用。默认不裁剪键；只在明确选择的 CHAR padding 策略下转换，原值保留并拒绝碰撞。状态含义不从非空记账人猜测。
- `CoreReconciler`：真实主从/科目引用、键碰撞、逐张借贷、日期/期间、年初和账前借贷、本月已过账发生额对账；负数不转正，NULL/缺行不补零，不去重或重编号。`ExactNumber` 保留任意精度十进制预演，不转整数分；原 double round-trip 文本与 PB 二进制运算顺序仍是不同验证问题，不以容差掩盖差异。
- `CompatibilityPreview.RunAsync`：失败/取消/差异/口径未知均不返回投影候选；外部自报副本也为 Incomplete。始终 `ApplyAllowed=false`，原格式可用性/兼容性 `not_assessed`，Windows `not_tested`。只有合成核心口径通过可返回 `ProjectionForReview`。
- `PreflightReceipt.Parse` 直接消费 PR39 0.1.1 报告，不重造扫描/哈希。明确选择 `database_coverage.database_input_id`，拒绝重复键/矛盾状态；完整预检不证明备份一致或快照来源。报告固定 `InventoryToExtractionBinding=not_established`、`PhysicalSourceImmutability=not_assessed`。
- `PreviewReportPublisher.PublishNewAsync`：真实摘要输出，create-new staging、flush、同目录无覆盖 rename；已有源/报告/目录目标失败并清理自有 staging。报告不含原配置/路径/完整业务快照/provider 原异常；真实差异报告仍含金额、科目范围和哈希，应留本地。

回滚界限是丢弃内存投影和自有报告 staging；没有业务写入/迁移，故没有冒称已验证数据库迁移回滚、原地升级、断电恢复或跨库原子性。

## 公共核心检查点及适配桥

已直接读 PR52 精确 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的 `docs/parity-handoffs/integration.md` 和 `src/Caiwu.Contracts/ParityModules.cs`。

主库独立编译，无共享 Contracts 依赖。`CompatibilityModuleAdapter` 生成 `compat` 模块 schema1 报告存档计划。独立可选 `ContractsBridge/Caiwu.LegacyCompatibility.ContractsBridge.csproj` 使用上述真实契约：`PrepareReportArchival(report, ModuleLedgerSnapshot)` 从同一用户所见快照复制 ExpectedBookId/ExpectedRevision，生成 `ModuleDocumentBatch`；`ArchiveReport` 只调用 `SaveModuleDocuments`，不刷新 token、不重试、不吞授权/存储异常。payload 仅为报告，稳定 ID 为其 SHA256；不能把外部 JSON 当作与总账原子一致的权威状态。

**未调用 `AcceptVoucherProposal` 导入原凭证。** 该接口只产生新草稿，当前 VoucherLine 仍只有科目/摘要/decimal 借贷，不能承载旧凭证原身份、审核/过账历史及所有维度。此切片也没有需要生成的新业务凭证。

基线 main 缺 `ParityModules.cs`，所以桥为独立可选项目。通过 `-p:CaiwuParityContractsProject=<exact-checkpoint-project>` 指向隔离 /tmp 的真实检查点 Contracts 已编译/执行 probe，没有编辑共享目录。公共 Core/SQLite 真实事务和真实 OperatorSession 授权尚未测试，不能称已接通。

## 需集成者统一解决的精确缺口

1. 不得把原数据压成旧 `Account/VoucherLine/OpeningBalance`。统一存储需保留上列所有标志/默认维度、原凭证四元身份/行号、制单/审核/记账人/日期/状态、原币/汇率/数量/单价、项目/客供/部门/人员/现金流量/合同、附单/到期日、年初/账前及辅助/币种粒度、所有未知列/表与 BLOB，并保留声明类型/NULL/空格及来源指纹。
2. 若未来扩展 `VoucherProposal`，须补完整维度及精度/原值容器；它仍不能代替“保持原历史状态的导入”接口。历史导入另需 schema/status/aggregation profile 白名单、稳定来源身份、目标账套全局 CAS、提交前对账和隔离目标事务；不能把新 GUID/新草稿当成原号/过账状态已迁移。
3. provider 必须绑定预检 input ID/前后文件哈希与读取快照，核实账套代码→物理库/owner、完整目录和一致性只读会话；只发 SELECT 不证明物理文件不变。当前接口无凭据生成/猜测/重置能力。
4. 宿主应先核实所见 ModuleLedgerSnapshot 的真实权限，再调用报告存档；报告存档权限不能隐含源数据库身份或原账套写入权限。恢复/导入按钮不得用“存了报告”冒充真正恢复完成。
5. 原始大对象/完整业务迁移未来可能超公共模块文档预算；必须显式分块/清单/完整性与事务设计，不能静默删列、截断、自动重试或把多个外部文件说成同事务。当前桥只存小型报告。

## 验证证据

Linux，.NET SDK 10.0.403（满足根 global.json 10.0.402/latestPatch）。实现冻结 SHA 如首行；其后仅本交接变化。

```sh
CAIWU_DOTNET_ROOT=/tmp/caiwu-dotnet tools/dotnet-local.sh test \
  tests/Caiwu.LegacyCompatibility.Tests/Caiwu.LegacyCompatibility.Tests.csproj \
  -c Release -p:RestoreLockedMode=true --nologo \
  --logger 'trx;LogFileName=compat-synthetic-release.trx'
```

退出 0；41 通过、0 失败、0 跳过，编译 0 warning/0 error。实际 TRX counters total/executed/passed=41，failed/error/notExecuted=0。本地 TRX 在忽略的 tests 子目录 TestResults，未上传含本机路径的日志。

`SharedContractsProbe` Release 针对固定 5bb60d2 的真实 Contracts 副本执行六个合成断言通过：同一账套/revision、兼容模块单文档、ID/版本/payload、无新草稿/取新快照、旧 revision 冲突传播且不重试；输出明确 `core_sqlite_transaction=not_tested`。

PR39 既有 CLI 对四个运行时合成文件执行退出0，生成本模块最小 synthetic 预检 fixture；无配置正文/路径输出。主测试覆盖实际 DbDataReader、扩展列/BLOB/精度、所有核心 grain 的碰撞、孤儿、schema/owner 漂移、NULL/日期、显式 padding、未知状态、草稿排除、余额/发生额差异、取消/异常脱敏和禁止覆盖/清理 staging。独占文件范围、Markdown 相对链接与 git diff --check 通过。

有价值的失败：首轮测试错误地按 F001 选数据库，预检适配器拒绝；改为报告真实 F004 后通过，不能假定第一个文件为库。一次 `dotnet test --locked-mode` 参数不适用，已改为 `-p:RestoreLockedMode=true` 并实际通过。PR52 ref fetch 曾因本机 Git HTTPS 缺交互身份失败；精确提交对象/两个文件已成功读取，不影响契约 probe，后续授权分支 push 已成功。无自动审批拒绝、无数据库动作结果不明。

## 剩余验收与边界

- blocked：SQL Anywhere 真实驱动、精确版本/位数、合法身份、第二份副本只读会话和原文件停止后哈希证据；`SqlAnywhereReadOnlyExtractor` 现在明确拒绝提取，不读真实账套。
- pending：所有 schema 变体、账套/owner 映射、原状态码、辅助/外币/数量及全部其他模块/报表/BLOB 解释；当前只保留它们，不称已业务兼容。
- pending：目标无损历史导入与可验证事务/回滚、公共 Core/SQLite/权限/宿主 UI 接线、Windows 及原版对照。合成和编译不覆盖这些验收。
- 原 [gap-analysis](../original-analysis/gap-analysis.md) 所有原未实现项继续有效；原账套兼容为必需，其旧“可选”文字不作为缩减授权。PR38 暂不切底层的旧前提已由新授权替换。
- 没有运行原程序/安装器/原数据库工具，没有重复解包、密码尝试、真实账套读取/写入，没有上传原始安装资源、新的完整派生分析或真实报告，没有改/合 main、公开、改权限或购买额度。

集成取本分支从基线后的完整三个提交（早期 HANDOFF → 实现冻结 → 本文证据），或等价完整分支 diff；不要只取末尾修改已有 handoff 的提交。
