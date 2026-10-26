# 原账套只读兼容预演：第一切片

本模块把关系读取器输出冻结成保留原字段的快照，投影核心科目、凭证及期初/月度发生额，执行关系与数值对账，并生成只创建新文件的预演报告。当前实际 SQL Anywhere 驱动/已验证只读副本会话不可用；`SqlAnywhereReadOnlyExtractor` 明确报缺，不连接、不猜密码、不启动引擎。

**这是可编译、可测试的只读垂直切片，不能打开原账套，也不提供历史导入、写回、升级或迁移。** 原软件全部功能、菜单、窗口及账套兼容仍以仓库既有原版分析和验收清单为目标；旧 0.1.0.4 和本模块合成测试均不能代表目标完成。

## 输入与提取边界

- `ILegacyReadOnlyExtractor.ExtractAsync` 是唯一提取接口，没有写入、连接参数、授权修改或引擎启动入口。
- `RelationalReaderCapture.CaptureAsync` 实际读取 `DbDataReader`，严格核对目录列名/顺序，逐行捕获；超行数预算、未知 provider 值或非有限浮点数时失败，不返回截断表。它不拥有连接或 reader 生命周期，不验证连接/引擎是否物理只读。未来 provider 必须在封存备份的第二份副本上完成版本化只读会话、完整表枚举及停止后文件哈希核对。
- `SyntheticDataSetExtractor` 只用于明确合成 fixture，构造时冻结所有表；不能把其标签作为原库验证证据。
- `LegacySnapshot` 保留精确 owner/表名、列序/声明/可空性、源读取顺序、每个值和全快照内容指纹。NULL、空串、尾随空格、日期、decimal scale、浮点 round-trip 文本和二进制 Base64 分开保存。未知表/列不会被投影过滤掉；二进制保存的是 provider 已解码的 CLR 值，不声称验证了原数据库页面/字符集/二进制存储编码。
- schema 指纹包括 owner、表名及列顺序/声明/可空性，不是完整 DDL/索引/约束/触发器指纹。源行序号是本次读取的 1-based ordinal，不是擅加的原数据库主键。

预检直接复用 [PR #39](https://github.com/xhc144/caiwu-suite/pull/39) 的 `tools/original-compat-preflight/preflight.py`（固定 head `11a8d77689ca9a6408fe493e7c1fcc10519db4a6`）。`PreflightReceipt.Parse` 消费其 `original-compat-preflight-1` / 工具 0.1.1 报告，拒绝重复 JSON 键、矛盾状态和错误数据库 ID，不重新扫文件或计算文件哈希，也不跟踪报告中的路径。

数据库必须按报告中 `database_coverage.database_input_id` 明确选择，不能假定是 `F001`。文件清单完整不证明备份一致、快照来自该库或原格式可用。当前报告固定 `InventoryToExtractionBinding=not_established`、`PhysicalSourceImmutability=not_assessed`；原始输入与提取快照的绑定仍须未来 provider 验证。

## 核心映射

`CoreMapper` 要求五个不同角色的**精确 owner/表名及实测 schema 指纹**。不按模板编号或同名表推断 owner，不把 `tables.json` 主要变体当成全部模板 schema。所有 DTO 同时引用完整源 `LegacyTable` / `LegacyRow`。

| 源表/字段 | 核心投影 | 保留边界 |
|---|---|---|
| `kmbm.kmbm/km_mc/kmjs` | 代码、名称、级数 | 不推导父级/末级，不重编码 |
| `kmbm.yefx/sybz` 及 `kmsx/zhlb/fbs/sls/xms/dws/bms/grs/wls/xjs/yjd` | 原方向/停用/业务标志字符串 | 不猜字符含义，不把未知当 false |
| `kmbm.bz/dw/xmbm/dwbm/bmbm/grbm` | 默认币种、单位及辅助代码 | 原值同时保留 |
| `pzdj.nf/yf/pzlx/pzbh` | 四元凭证身份 | 不用新 GUID 替代原号/行号 |
| `pzdj_rq/pzdj_bz/pzdj_zdr/pzdj_shr/pzdj_jzr` | 日期、原状态码及三类人员 | 状态码不从非空记账人猜测 |
| `pzdj_fds/pzdj_shrq/pzdj_jzrq` | 附单数、审核/记账日期 | 缺失/NULL 保留；时间戳不强截成日期 |
| `pz` 四元身份 + `pz_xh/kmbm/pz_jf/pz_df` | 凭证身份、原行号、科目、借贷金额 | 不去重、不重新编号、不转整数分 |
| `pz_wb/pz_hl/pz_sl/pz_dj/bz/dw` | 外币、汇率、数量、单价、币种/单位 | 转换不丢精度；本切片不验证外币/数量业务规则 |
| `pz_zy/jslb/pz_ph/dqrq` | 摘要、结算类型、银行单号、到期日 | 原空串/NULL/空格分别保留 |
| `xmbm/dwbm/bmbm/grbm/xjbm/htbh` | 项目、客供、部门、人员、现金流量、合同 | 不剥离维度，不伪造辅助档案关系已验证 |
| `nc.nf/kmbm/bz/nc_jf/nc_df/jq_jf/jq_df` 及四个 `_b` 字段 | 年初、账前发生额及本位币列 | 原币与折合值不混用，NULL 不补零 |
| `hz.nf/yf/kmbm/bz/xmlb/xmbm/jf/df/wbjf/wbdf` | 期间、汇总粒度、本位币/外币发生额 | 辅助/币种粒度不合并，不推定汇总规则 |
| 其他字段/表，包括 BLOB | 原快照原样保留 | 不是“这些内容已兼容”的结论 |

数值计算使用 `ExactNumber`：任意精度十进制系数/scale，支持科学记数，不做 cents/decimal 范围截断、舍入或容差。浮点值保留 provider 的 round-trip 文本，再按该文本做精确十进制预演；这**不是原 PB 的二进制浮点运算顺序**。例如 `0.30000000000000004` 对 `0.3` 明确报告差异，不放宽容差掩盖。

默认保留精确键；只有显式 `TrimDeclaredCharPadding` 才裁剪声明为 `char(...)` 的键尾空格，VARCHAR、摘要、原单元格不改。变换产生碰撞时拒绝，不去重。

## 对账口径与结果

`PreviewInterpretation` 必须显式给出期间、本位币、参与的末级科目范围、期初金额基础、`hz` 基础辅助粒度、是否仅含已过账，以及原状态码解释和审阅依据。它们是调用者声明，报告会保留完整口径及依据引用的哈希，不认证其为原版规则。

执行科目/主从/行身份碰撞、孤儿行/缺科目、空主表、凭证日期与期间、逐凭证借贷、所选范围年初及账前借贷、本月已过账凭证对 `hz` 逐科目借贷。负数反冲值保留。范围不完整或金额/汇总依据未知、状态码未解释、缺余额行或基准列时为未评估；不能按缺失=零处理。外币/数量/辅助及其他模块保留但不对账，不计算缺少历月依据的任意期末余额。

- `CorePreviewReconciled`：只表示**合成数据**的这组核心对账和声明口径通过；返回 `ProjectionForReview`。
- `Rejected` / `Incomplete` / `ExtractionFailed` / `Canceled`：投影为 null，报告不提供部分可应用候选。
- 外部副本即使数值一致，也因会话/停止后哈希未验证而 `Incomplete`。
- 所有报告始终 `ApplyAllowed=false`、原账套可用性/兼容性 `not_assessed`、Windows `not_tested`。

报告包含账套结构、科目范围、文件哈希和差异金额，真实报告应留在获准本地范围；不包含原始配置正文、文件路径、完整业务快照或 provider 异常。证据摘要不能替代完整业务迁移验收。

## 发布与回滚界限

`PreviewReportPublisher.PublishNewAsync` 将摘要写入同目录新建 staging 文件，flush 后无覆盖重命名；既有文件/链接或目录占位时失败，只清理本次 staging。取消/映射/提取/对账失败不产生可应用投影。报告发布成功是文件提交点，之后的取消不会删除它。

本切片从不调用源/目标业务写入；“回滚”仅指丢弃内存投影及自有报告 staging，**没有实施或验证数据库迁移回滚、原地升级、引擎恢复、断电恢复或跨文件事务**。

## 公共事务桥接

主库无共享 Contracts 依赖。`CompatibilityModuleAdapter` 产出报告存档计划；独立可选项目 [ContractsBridge](ContractsBridge/Caiwu.LegacyCompatibility.ContractsBridge.csproj) 使用 PR #52 固定检查点 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 的真实 `ModuleLedgerSnapshot` / `ModuleDocumentBatch` 类型。

`CompatibilityContractsBridge.PrepareReportArchival` 从**同一个用户所见快照**复制账套 ID/revision；`ArchiveReport` 只调用 `SaveModuleDocuments`，不刷新 token、不重试、不吞权限/存储错误。模块 ID 为 `compat`，版本 1 的文档仅存报告；ID 由 payload SHA256 稳定生成。原数据不通过新草稿 API `AcceptVoucherProposal` 降格导入，外部报告文件不作为与总账原子一致的权威业务状态。

基线 main 尚无这些新公共契约，可选桥不能在旧 Contracts 下编译。集成者接入精确检查点后才构建此项目；本轮用 `/tmp` 的检查点 Contracts 副本编译并执行合成宿主 probe，未修改共享目录。公共 Core/SQLite 真实事务、权限及宿主 UI 接线仍待集成；不注册假窗口或启用无 handler 的菜单。

## 构建与验证

```sh
dotnet test tests/Caiwu.LegacyCompatibility.Tests/Caiwu.LegacyCompatibility.Tests.csproj \
  -c Release -p:RestoreLockedMode=true

# 仅在已获得/集成 PR52 精确 Contracts 后；可显式指向隔离的 Contracts 项目
dotnet run --project tests/Caiwu.LegacyCompatibility.Tests/SharedContractsProbe/Caiwu.LegacyCompatibility.SharedContractsProbe.csproj \
  -p:CaiwuParityContractsProject=/local/contracts-checkpoint/Caiwu.Contracts.csproj
```

合成 fixture 和范围详见 [测试说明](../../tests/Caiwu.LegacyCompatibility.Tests/README.md)。逐项结果、精确 SHA、剩余原版验收及共享核心要求见 [compat handoff](../../docs/parity-handoffs/compat.md)。
