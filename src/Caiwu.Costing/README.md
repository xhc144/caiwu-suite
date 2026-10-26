# 原版成本／进销存保真切片

新入口是 [Parity/](Parity/) 的 `InventoryWorkflow` 与 `InventoryVoucherPlanner`，不再把人工工作表作为原版成本核算路线。实现产品档案、仓库／车间隔离、期初、采购入库／销售出库／领用出库、审核保护、盘点、单月月末加权核算／取消、四类平衡凭证计划。原始行袋保留变体字段、NULL、原数值文字和尾空格；不包含原账套驱动或自动迁移。

[Wpf/InventoryParityDialogs.cs](Wpf/InventoryParityDialogs.cs) 提供成本核算、取消核算、仓库／车间选择的实际窗口操作；控件矩形按原 PBU 等比缩放，未发明 DataWindow 内部坐标。其余窗口 UI、Desktop 菜单注册及原格式验收仍待补齐。

[Adapters/](Adapters/) 是独立项目，对接公共接口检查点 `5bb60d2`；权威状态通过 `SaveModuleDocuments` 保存，凭证通过一次 `AcceptVoucherProposal` 同送来源认领与模块变更。每个 adapter 只使用用户开始本次操作时的同一 `ModuleLedgerSnapshot`，提交后必须显式重载，不自动更新 token 或重试。当前只验证契约和合成服务，未宣称 Core/SQLite 已接通。完整接口、构建命令、实现选择及未完成验收见 [inventory handoff](../../docs/parity-handoffs/inventory.md) 和 [本轮验证](../../tests/Caiwu.Costing.Tests/PARITY_VALIDATION.md)。

以下保留旧实验 API 的说明供已有调用兼容；其移动加权与人工工作表不作为原版保真完成证据。

---

# 成本核算领域首版（实验模块）

仅支持人民币、单月、单库存账册/仓位、单计量单位的普通商品与简单完工批次，未获生产制度验收。全部输入输出为本命名空间的record，计算无I/O、时钟、随机数、总账或共享Contracts依赖；不构成完整ERP、完整行业成本制度或税务模块。

## 对外API

| API | 行为 |
|---|---|
| `InventoryCosting.Create(inventoryId, period, items, openings, policy?)` | 创建独立成本账册快照，目录区分商品、原材料和产成品。 |
| `InventoryCosting.Apply(snapshot, operation, expectedRevision)` | 返回新快照、成本发生额、IsReplay及待审核凭证建议。 |
| `ProductionCosting.Create(inventoryId, period, laborBasis, overheadBasis)` | 明确选择人工和制造费用各自的分配依据。 |
| `ProductionCosting.Allocate(productionSnapshot, inventorySnapshot, request, expectedRevision)` | 引用真实领料事件，分配人工/制造费用，返回每个成本对象的产品成本及待审核建议。 |

库存支持 `PurchaseReceipt`、`SaleIssue`、`MaterialIssue`、`CustomerReturn`、`ProductionReceipt`。`SupplierReturn`、`MaterialReturn`有明确类型但调用必定拒绝，不作错误的移动平均逆转。公开DTO和异常见 `Models.cs`；错误为 `CostingValidationException` 或 `CostingConcurrencyException`。

## 固定政策与金额守恒

库存政策固定为 `moving-weighted-average-rmb-v1`、移动加权平均、禁止负库存；FIFO、月末加权和允许负库存均明确拒绝。数量/工时最多4位小数、采购单价最多6位、金额最多2位，数量和采购单价上限十亿，金额上限92233720368547758.07元。输入多余有效精度不截断；采购价款乘法与成本派发在整数单位上精确计算，派发到分采用四舍五入（AwayFromZero）。显示平均单价6位，出库不使用显示单价。库存数量归零时成本一并清零。

采购成本分为单价价款、**已由业务审核认定可资本化**的采购费用、不能抵扣税额、当期费用，后者不进入库存。首版每条采购业务对应单个存货；未实现多品种联合采购费用自动分配、暂估、跨期到票、采购价差或可抵扣增值税计算。输入金额必须是已确认的成本组成，零金额表示已确认零成本，不能把未知成本默认为零。本模块不判断所有运费应资本化，也不推断税率/纳税资格。

销售按当时库存数量金额比率发出成本；销售退回必须引用本期原销售，累计退回数量不得超出原销售。按原出库总成本×累计退回数量/原数量得到累计应回成本，再减以前已回成本，避免多次退货舍入超额；末次退回补足原成本。原材料只能生产领料，商品和产成品可以销售；生产完工只能接收同账册、同期间、同存货、完整数量的生产结果，同批次成本对象不能换业务ID重复入库。

生产政策版本 `completed-batch-largest-remainder-rmb-v1`。仅支持无期初/期末在产品、无联副产品的完工批次；零产量、非零在产品、无效产品与来源不匹配均拒绝。直接材料来自库存 `MaterialIssue` 的实际派发成本且成本对象必须相符，同领料不能在不同批次重复归集。人工/制造费用分别按产量、人工工时或机器工时分配，已存在批次后不允许修改其政策。非零费用池配零总基数拒绝；零池配零基数返回零。分配采用BigInteger整数分和精确余数：先取整，剩余分按余数从大到小派发，同余数按成本对象Ordinal排序，保证金额守恒且不受输入产品排序影响。

所有业务限本月；补插早于最后业务日期的记录、跨期退货和自动结转不支持。需要下期时由主集成另行设计审定的结转及期初衔接流程，不能直接修改已有快照的期间/政策重算历史。

## 幂等、存储与总账对接边界

每个业务必须有非空Guid标识、规则版本和expectedRevision。同ID相同内容返回原发生额/结果及IsReplay=true，不增加revision；允许有效旧revision的原样重试。同ID不同内容/政策拒绝。指纹使用稳定类型/域标记、SHA-256及文化无关的decimal规范表示；1.0与1.00等值。负revision拒绝。成功的新业务只增加1个revision，失败不修改输入，返回列表均只读。

**纯计算不能替代数据库事务。** 两个调用者各拿同一旧快照仍可各自计算出结果；主集成持久化时必须以事务CAS校验revision，固定每库存账册/期间的唯一生产快照，建立业务ID和领料引用的唯一约束，并核验来源版本。快照、生产结果及费用池属于可信输入，不是签名凭证或防篡改票据；不得让外部输入直接伪造 `ProductionOutputCost` 后入库。持久化、审计、权限、费用来源防重和跨模块原子提交由后续集成承担。

`PendingCostVoucher` 仅含语义科目角色，唯一来源键为 `(InventoryId, Origin, BusinessId)`，状态始终 `PendingAccountingReview`。同一业务重试会重复返回相同建议，接入方须按此键防重。总账适配器必须将角色映射到实际制度的启用末级科目、补全/复核结算和税额、验证制单审核分离，再调用总账草稿接口，不能自行记账。采购建议为已输入成本组成及期间费的赊购建议，不含可抵扣税额或付款结算处理；人工和制造费用视为尚未转入该批生产成本的费用池，不得重复归集已处理费用。

生产领料先建议借在制/贷材料；生产分配只建议人工及制造费用，不重复生成材料建议；完工入库建议借产成品/贷在制。所有建议借贷平衡，零金额不生成空凭证。真实账套、UI、持久化和总账均未连接。

## 官方依据与实现选择

已读指定 `enterprise-cost.md` 正式规则研究材料（本容器副本来自已核验规则ZIP），并核对[存货准则第5—9、14条](https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/2006zcfb/200805/t20080519_23107.htm)及[财会〔2013〕17号成本核算制度](https://cwfwpt.ggj.gov.cn/zcfg/qykjzd/202306/P020230620583246761887.pdf)。前者规定采购/加工成本及可选发出计价法，后者要求按经营特点归集分配、区分成本与期间费、政策不可随意变更。移动加权、精度边界、尾差排序、零产量拒绝及业务幂等机制是本首版明确的软件选择，不冒充财政部指定算法或全行业适用结论。2026科目征求稿未作为正式规则部署。

独立手算及实际命令结果见 `tests/Caiwu.Costing.Tests/VALIDATION.md`。未覆盖减值、盘点、调拨、换算、批次FIFO、退料、供应商退货、在产品、复杂分步/联副产品、特殊行业、完整增值税及财务报表。

## 可编辑工作表与独立页面（本轮新增）

成本来源已明确、需要手工输入与复算时，使用 `CostWorksheetService` / `CostWorksheetEditor`；支持材料/人工/制造费用池、精确尾差审计、有限整批多阶段承接、JSON复算导入与安全JSON/CSV导出。独立WPF组件位于 `Wpf/`，主入口、Core、Contracts及SQLite均未改动。完整操作、API和接入约束见 [WORKSHEET.md](WORKSHEET.md)；验证与未验项见 [tests验证](../../tests/Caiwu.Costing.Tests/SPRINT_VALIDATION.md)。这不是原库存事件API的替代入口，也不会自动记账。
