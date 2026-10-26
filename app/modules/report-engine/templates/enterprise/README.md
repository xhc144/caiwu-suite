# 企业报表（W2-02）

来源：`rules/sources/official/enterprise-2019-appendix2.pdf`，资产负债表第2–3页及说明第3–10页、利润表第10–11页及说明第11–15页、现金流量表第15–16页。此文件是报表格式，不是完整科目编码来源；`books-enterprise-review` 的9科目只是待核工程样例。

## 功能清单

- 本次实现：报表管理→`w_bb_get` 引入、`w_bb_proc` 生成/重算、`w_bb_saveas` Excel 导出的企业表样，编码201/202/203，严格使用实际 `ReportTemplateSchema`。表样包含所有列示项目（含其中项、其他综合收益扩展项、每股收益），不是会计科目模板，也不会自动登记成已完成的法定报表。
- 本次实现：`buildBalanceSheetSlice` 按显式账户映射启用部分期末余额；固定资产须映射原值、累计折旧、减值、清理全部相关账户，借正贷负直接求净额，负债/权益改为贷方正数。拒绝重复账户及上级下级重叠。不启用需重分类项目、未分配利润和各合计。
- 本次实现：`buildCashflowSlice` 按明确的现金账户和现金流量项目映射取当前月净发生额；退款反向冲减、已映射账户间同项目内部划转净抵销。所有直接组成项均配置后才计算相应小计。政府补助应映射到“收到其他与经营活动有关的现金”（PDF第16页说明），不能按资产相关/收益相关分流。
- 本次实现：待配置金额以文字保留；比较数不冒充本月期初；完整性未满足时保留全表“未完成”提示。勾稽检查直接引用实际总计，待配置时显示错误，不能据局部金额判断全表平衡。
- 沿用引擎：只读表样可复制；重复编码不覆盖、未过账先确认、权限检查、同事务取数、生成失败保留上次快照、真实xlsx。独立测试使用core/testkit，不依赖同波其他页面。

## 未完成项与共享需求

- 完整资产负债表取数；上年年末/年初和追溯调整比较数；应收、预付、应付、预收逐末级/往来借贷重分类；应交税费中待抵扣等增值税借方明细的资产列报；坏账准备逐项目分配；期限及正常营业周期分类；合同资产/负债同合同净额及减值；债权投资、租赁负债一年内到期拆分；合同取得/履约/退货成本与应付退货款；金融资产及权益工具分类；未分配利润加结转前本年损益；长期应付款扣融资费用并加专项应付款；投资性房地产计量模式等。未映射账户不推断为不适用或零。
- 完整利润表数值、同比/环比/上期口径选择；排除损益结转的净发生额、红字和退回；研发/管理费用拆分且不得重计；利息费用/收入其中项；投资收益明细、减值损失符号、持续/终止经营、税后其他综合收益明细与每股收益。当前全部利润数值保持待配置，不能当成可用利润表。
- 完整现金流量表：项目多对多分配及分配完整性、无项目现金分录定位、内部划转/非现金交易自动排除、现金等价物/受限资金定义、汇兑影响、期初期末及比较期间；本切片不根据货币资金余额冒充现金及现金等价物。
- 共享owner扩展合同建议（不是现有API）：保留 `BALANCE(account, metric, unit, currency, direction, dimension, item)` 7字符串签名；新增 `BALANCERANGE(account, metric, unit, currency, direction, dimension, item, fromSelector, toSelector, transferScope)`。`fromSelector/toSelector` 至少支持 `current/yearStart/previousMonth/previousYearEnd/previousYearSameMonth`；`transferScope=all/excludeClosing` 应利用现有 `voucher.closing_kind='pnl'`（`period-close/server/transfers.ts` 已写入），账簿查询尚未暴露此过滤。不得按摘要猜测，也不能排除全部普通自定义结转。年度期初早于账套启用时应拒绝或显示未提供，不能编零。
- 重分类需新增独立函数或服务：对指定末级科目及往来项分别取借方/贷方期末余额，再汇总；合同按合同ID净额后分流动性。不能对总账汇总净额做一次正负拆分替代。
- 未改共享server/shared/web，无自动模板安装/映射页面。原引擎README全部未完成项继续有效：旧S/W/F别名、外币/数量累计、现金流量期初分配、跨账套/旧备份引入、粘贴撤销及插删行列、完整格式/分页套打、布尔审核、取数追踪及辅助穿透、关闭确认与草稿合并、超大报表性能、报税及共享打印/桌面，均未在此补齐。

## 试用

1. `cd app`，Node24与pnpm10.28，`pnpm install --frozen-lockfile`。
2. `pnpm exec vitest run modules/report-engine/test/enterprise`；`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm check`（未设置CI时零retry），或先`pnpm build:web`再`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test modules/report-engine/e2e/enterprise --retries=0`。
3. 报表管理→导入模板JSON→选择本目录201/202/203文件。生成与导出都保留待配置文字；这只试用表样，不是完整三表。
4. 局部取数：`buildBalanceSheetSlice({ cash: ['确认过的账户编码'], fixedAssets: ['原值编码', '折旧编码', '减值编码', '清理编码'] })`；`buildCashflowSlice({ cashAccounts: ['确认过的现金账户编码'], items: { salesReceipts: '确认过的现金流量项目编码' } }, await svc.accounts.list())`。builder返回实际`ReportTemplate`，再经`router.importTemplate`导入；账户不存在时真实生成会拒绝，现金映射另校验全部末级是现金/银行，账户与项目映射各自最多6个取数账户根。具体独立造数及手算对照见本模块`test/enterprise`和`e2e/enterprise`。不要用9科目工程样例替代完整科目映射。
