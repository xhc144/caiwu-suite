# 固定资产保真切片

本模块基于 `main@3b0c59b` 的既有原版分析，拥有自己的领域模型、存储边界、合成测试和 WPF 子项目。未修改公共 Contracts/Core/SQLite/Desktop/解决方案。它是原功能升级的一个切片，不代表固定资产全模块、原界面或原账套兼容已经完成。

已实现真实服务行为：卡片增加/修改/草稿删除，原值调整及撤销，使用部门/用途/位置转移，注销；月折旧、最后月份撤销、查询和资产台账；增加/折旧/注销的借贷平衡凭证计划及计划撤销。凭证计划不代表总账草稿已经生成。

## 调用与存储

```csharp
var initial = AssetSnapshotCodec.Deserialize(File.ReadAllText(explicitSyntheticFixturePath));
var store = new InMemoryAssetBookStore(initial);
var assets = new AssetBookService(store, initial.Identity);
var seen = assets.Read(); // identity + whole-book revision from the same editing decision
assets.AddCard(seen.Revision, newCard, additionDate);
var next = assets.Read();
assets.CalculateDepreciation(next.Revision, next.NextDepreciationPeriod, explicitPeriodWorkloads);
```

合成 fixture 为 [`tests/Caiwu.FixedAssets.Tests/Fixtures/empty.assets.synthetic.json`](../../tests/Caiwu.FixedAssets.Tests/Fixtures/empty.assets.synthetic.json)，只有虚构科目和资料，不读取原程序或真实账套。`SyntheticJsonAssetBookStore.Create/Open` 可将这个独立切片保存/重开为显式的 `.assets.synthetic.json`，使用 sidecar 独占锁、CAS 和同目录原子替换；不接受 `.db/.caiwu`。这不是生产数据库适配器，也没有与外部总账的跨文件事务或断电恢复保证。

`IAssetBookStore` 的实现必须在一次事务里检查账套身份和全账套版本，保存整个固定资产聚合。不要对并发失败刷新版本自动重试。`AssetModuleDocumentCodec` 是版本化模块权威文档；`AssetSnapshotCodec` 是单独的合成工作区格式。高版本、重复键或未知模块 JSON 字段不得降级/丢弃后重写。

`ParityAdapter/` 针对 PR52 精确契约检查点 `5bb60d24b9c60c9eecfcc5adc37bced4688adf85` 编译：同次 `ModuleLedgerSnapshot` 返回的账务/模块/收据来自同一 revision；模块文档用 `SaveModuleDocuments` 与审计同事务提交。这个 PR 的 main 基线尚无新公共 API，适配器是独立可选项目，需要先集成该契约，或用 `CaiwuParityContractsProject` 指向它的独立 checkout。未将检查点拣选到本分支共享目录。

当前 `VoucherProposal` 只有四字段 `VoucherLine`，不足以无损表示部门等资产分录信息；`PrepareVoucherProposal` 在任何总账写入之前明确拒绝。不会将模块 JSON 保存成功称为凭证转账成功。读取到的 `ProposalReceipts` 会阻止直接撤销已接收计划。精确扩展建议和宿主接线见 [assets handoff](../../docs/parity-handoffs/assets.md)。

## 本切片的计算规则

- 原版卡片明确：使用当月不计提，次月开始。按自然月顺序执行，不能跳月/重复，关闭期间和只读账套不能写。
- 新引擎政策：金额为 decimal，输入精确到分，折旧四舍五入 `AwayFromZero`。直线法按剩余可折旧基础/剩余月数计算，原值调整按剩余期限前瞻生效；最后一期清到预计残值。工作量法按剩余可折旧基础/剩余工作量计算，每次必须明确提供当月工作量，拒绝负数/超过剩余工作量，最后工作量清尾差。状态是否计提由显式参考资料控制。
- 残值率 API 使用 0..1，预计残值金额独立保留并参与计算；导入器不能猜原 `czl` 的比例单位。`OriginalMethodCode` 独立保留，不能仅凭枚举值断言完整原 `zjff` 映射。
- 注销当月仍计提，下月停止；注销计划必须等当月计提完成，取该月快照的净值和累计折旧。此政策及完整原算法仍须原证据/验收确认。
- 取消只允许最后有效批次；存在有效凭证计划或后续卡片变动时拒绝。撤销恢复完整卡片快照，已取消批次留存，重新计提使用相同年月业务来源键。
- 计划业务键按产品/原账套/类型/资产身份或折旧月份稳定生成，重开或重算不以随机键绕过重复保护。后续调拨不改写既有采购计划的历史分录。

这些是明确可测试的新引擎政策；除使用当月规则等已有直接文字依据外，不声称已证明与原运行时逐分一致。

## 字段与原资料

`AssetCard` 明确保留已知卡片字段，包括币种/外币金额、数量、原方法代码、参考号、制造/安装信息，附属设备、图片和类型化 `OriginalRows`。未知原列、NULL、文本精度及原始字节作为原始来源载荷保留；这份载荷是来源证据，不是已验证可直接写回原 SQL Anywhere 的映射。卡片/折旧/调整/变动历史不压入旧简化 DTO。现有表汇总只含主要变体，不能据此重建完整原库。

## WPF 和验收

`new AssetLedgerWindow(assets).ShowDialog()` 是独立模块审阅入口，不修改产品宿主。计提/取消/卡片/附属设备/注销/调整等窗口保留已知外层 PBU 控件边界，用 Viewbox 的抽象坐标缩放；不猜像素倍率。DataWindow 内部坐标尚无资料，当前字段网格的具体排版、继承菜单/工具栏、全部快捷键及原打印格式仍未验收。部分原入口尚未呈现，完整未实现清单保留在 handoff。所有已呈现操作都有实际服务、查询或打印行为。

## 构建与验证

需要仓库固定的 .NET SDK 10.0.402。Linux 上 WPF 只做交叉编译，不代表实际 Windows 操作通过。

```bash
dotnet test tests/Caiwu.FixedAssets.Tests/Caiwu.FixedAssets.Tests.csproj
dotnet build src/Caiwu.FixedAssets/Wpf/Caiwu.FixedAssets.Wpf.csproj
# After integrating PR52's exact contract, or point this property at its isolated checkout:
dotnet test tests/Caiwu.FixedAssets.Tests/ParityAdapter/Caiwu.FixedAssets.ParityAdapter.Tests.csproj \
  -p:CaiwuParityContractsProject=/path/to/contract-checkout/src/Caiwu.Contracts/Caiwu.Contracts.csproj
```

领域测试包含日期/闰年/跨年、残值/舍入/末期、重复计提/跳月、工作量、失败原子性、版本竞争、闭账、调整/撤销、注销/凭证金额、计划去重、完整载荷回读和真实合成文件重开。适配器测试使用明确的契约替身，不是 Core/SQLite 或 Windows 集成证据。未运行原程序、安装器、真实账套或 Windows 实机。
