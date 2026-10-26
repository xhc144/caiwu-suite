# 同账套民非接入适配

`NonprofitParityAdapter` 编译目标为 PR52 冻结契约 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85`。本分支不修改公共 Contracts；在集成该契约后可直接构建此项目。独立验证可设置 `-p:ParityContractsProject=/path/to/checkpoint/src/Caiwu.Contracts/Caiwu.Contracts.csproj`，指向另一个只读源 checkout。

```csharp
// host 是同一个真实账套会话，提供 IParityLedgerService 和 ILedgerService。
// authorizer 必须接宿主当前 OperatorSession 和原菜单权限，不能默认允许。
var adapter = new NonprofitParityAdapter(host, authorizer);
var edited = host.GetModuleSnapshot(); // 用户开始编辑/确认时取得，提交不刷新token。
var receipt = adapter.AcceptDraft(edited, proposalId, stableSourceKeys, enrichedDraft, operatorId);
// 分别由用户授权执行审核/过账，每次用当次确认的同账套快照。
adapter.ReviewAccepted(host.GetModuleSnapshot(), proposalId, differentReviewerId);
adapter.PostAccepted(host.GetModuleSnapshot(), proposalId, postingOperatorId);
```

首次需 `RegisterBookDefinition` 注册与公共科目逐项一致的完整a54元数据，再用 `ConfirmOpeningClassification` 保存与已有公共期初逐科目净额一致的分类；零期初也要明确确认。两者不会修改基础科目/期初金额。更改基础金额同时保存维度/分类尚缺公共事务API，不能先改一边再宣称原子接通。

模块ID：`regimes.nonprofit.v1`；文档：`book-definition`、`opening-classification`、`accepted-proposal:<proposalId N>`。所有权威模块JSON都由宿主同账套事务保存，没有外部JSON权威副本。接纳草稿时，四字段行只是公共执行投影，完整永久行ID、分类/限制版本、组成、外币/汇率/数量/单价/辅助维度、原字段及原声明均在同次 `AcceptVoucherProposal` 的模块文档中。重复提案和已消费稳定来源键拒绝；删除草稿不释放来源认领。

`ReadAcceptedVouchers` 在同一 `ModuleLedgerSnapshot` 中联结收据、完整文档和公共凭证；公共草稿字段改动而未同步增强文档时报 `NP_PARITY_VOUCHER_CHANGED`，不是按当前序号猜永久行ID。未知高版本、未知JSON成员、重复键、孤立文档/收据显式拒绝，不能降级保存。

`ReadWritableSnapshot(host.GetModuleSnapshot())` 还原给 `WritableNonprofitStatementDataSource` 的完整已记账来源；必须存在完整民非文档、与当前公共期初相符的分类，以及真实 Review/Post审计时间/人员。其他模块或旧界面产生的未分类凭证会明确报 `NP_UNCLASSIFIED_CORE_VOUCHER`，缺操作审计报 `NP_AUDIT_PROVENANCE`，不伪造日期。两表仍通过已有计算器保留缺项与勾稽，不把已记账适配称为完整法定财报。

```csharp
var enriched = adapter.ReadWritableSnapshot(host.GetModuleSnapshot());
var review = WritableLedgerIdentity.CreateUnreviewed(enriched, period, now);
// 用户明确复核科目全集、YTD、分类、年初、到期/减值/受托分析与成本组成。
// review填写完成后，数据源每次读取都会校验完整来源hash。
var source = new WritableNonprofitStatementDataSource(
    () => adapter.ReadWritableSnapshot(host.GetModuleSnapshot()), reviewedInput);
var statements = source.Calculate(now);
```

此项目已对冻结契约编译并运行7项**适配器合成宿主测试**，不是公共 Core/SQLite 的实跑证据。独立可写文件适配及完整两表闭环另有模块测试。公共集成和Windows原生验收状态见 [regimes交接](../../../docs/parity-handoffs/regimes.md)。原窗口描述注册不能直接变成空菜单：只有真实宿主/窗口/权限绑定后才能启用；凭证编辑的原运行时开窗入口当前未知。
