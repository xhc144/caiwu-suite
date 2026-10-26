# 民非三表（W2-04，未全部实现）

依据 `rules/sources/official/nonprofit-2026.pdf` 第128–153页和 `transition-2025-6.pdf` 第4–5页。对照民非原版“报表管理”菜单及 `w_bb_get/def/proc/saveas`；本目录只提供报表模板与验证，不重做共享引擎、权限或打印界面。

- 本次实现：401资产负债表、402业务活动表、403现金流量表的严格 `ReportTemplateSchema` 表样。401/402金额全部显示“待接入真实取数”，名称和标题明确为草稿，不能作为完成的报表使用。
- 本次实现：403的2026本年已过账取数切片，显式绑定现金/银行末级账户与24项现金流量分类。捐赠退回冲减原项目，资产处置列净额，内部划转不列收支；金额为整数分。分类依据随模板保存在说明行，不按项目名称猜测分类。
- 本次实现：独立core/testkit固定账套，403逐项手算比对、真实router导入/生成/重算/Excel导出；权限拒绝、失败事务保留快照、漏分类/重复分类/非法内部划转和整数分检查；独立Chromium E2E走现有生成页和真实下载。
- 本次实现：401独立年初黄金账套（资产249000分），涵盖受托现金移列、各类减值、到期重分类；402独立黄金账套涵盖限定/非限定来源明细、本月与累计、双向净资产互转、以前年度调整和损益结转。黄金测试没有接入401/402报表生成，不能据此认定报表完成。
- 首次2026例外：活动表、现金流量表不要求上年比较数；401年初余额仍需衔接后新账真实来源。2027表样恢复比较栏目；403取数切片拒绝非2026映射，预检也拒绝非2026期间。

未实现：401/402完整取数及其真实生成/导出E2E；调整后的年初数、以前年度比较口径；业务活动成本自定义组成明细；有适用条件的慈善信托支出/募捐成本取数；限定性持久分类与凭据校验；自动分析净资产互转/以前年度调整；排除损益结转的净发生额；受托代理现金移列与到期重分类绑定；现金等价物范围、汇兑影响的自动分析、跨年/年中启用分类；多现金项目拆分一条分录、超过4个现金账户的公式预算；报表附注、单位/日期自动填列、完整打印版式与法定模板自动安装入口。

403预检目前与router生成**不在同一事务**。原始router也尚不强制模板年度、仅已过账口径或预检；导入后单独选择2027/含未过账仍可能生成误用结果。现有名称/标题持续标记“切片”，没有交付为完整制度报表。每次生成应重新预检；生产接入须由共享owner解决原子性和服务端约束，不能仅靠提示文字。现金/银行账户必须逐一纳入或附依据排除；当前切片仅覆盖现金和可随时支付的银行存款，无其他现金等价物。手工分类及政策依据必须由真实单据支持，测试使用虚构数据。

继承的共享引擎未完成项全部保留：原版S/W/F别名、外币/数量累计、现金流量期初分配、跨账套复制、原版二进制/备份引入、批量粘贴、撤销重做、插删行列、字体/边框/分页/完整套打、任意布尔审核表达式、辅助项穿透及取数追踪、所有关闭路径/草稿冲突恢复、超5000单元格性能、其他制度报表、报税上传及共享桌面打印。不在本目录越界实现。

需要的共享接口（提案，尚未实现；由唯一owner决定最终合同）：

- 实际签名：`BALANCE(account,metric,unit,currency,direction,dimension,item)`，7个字符串。`metric`只有`opening/closing/debit/credit/ytdDebit/ytdCredit`；普通余额查询固定生成月份，`opening`是月初，不是年初。`REF(code,address)`也固定同期间。
- 建议新增`BALANCEAT(account,metric,unit,currency,direction,dimension,item,periodSpec)`，8个字符串，`periodSpec`为`current/yearStart/previousYearSame/previousYearEnd`；`yearStart+opening`必须读已调整年度期初，缺失比较来源应报错，不能补零。
- 建议新增`NETACTIVITY(account,range,restriction,closingPolicy)`，4个字符串；`range=month/ytd/previousMonthComparable/previousYtdComparable`，`restriction=unrestricted/restricted/all`，`closingPolicy=excludePnl`。返回整数分，借正贷负；限定性须来自带依据的专用字段或经确认的明细科目规则，禁止将普通project维度当替代。转限制及以前年度调整应另有可追溯分类，不以科目全部借贷发生额相减冒充。
- core实际`EntryRow`没有`closingKind`和限定性字段，但`svc.vouchers.get(id)`有`closingKind`；正式取数需要一次性按凭证来源过滤。现有`svc.ledger.balances({periodFrom,periodTo,accountCodes,dimensions,includeUnposted,rollup})`和`svc.opening.list(year)`可作为底层，但不能令每个模板各造一个取数引擎。
- 需要结构化、带来源的重分类输入：到期日/受托现金明细/各类减值分配/比较数调整/净资产转限制/以前年度调整/现金等价物政策及汇兑影响；无来源时阻止生成。年初受托现金和到期分类须按年初状态，不能拿期末分类回填。
- 共享生成入口需要同事务校验年度、适用制度、仅已过账、逐笔现金分类覆盖及内部划转；需保存分类依据、取数期间和预检来源版本，防止预检后账务变化。2026比较例外只豁免两张表的上年数。

试用：在`app`下运行`pnpm exec vitest run modules/report-engine/test/nonprofit`；设置`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`后运行`pnpm build:web`和`pnpm exec playwright test modules/report-engine/e2e/nonprofit --retries=0`。E2E会自行建临时民非企账套、用testkit造数据、调用真实`router.importTemplate`，再打开`/m/report-engine/view?id=…&period=202602`生成并下载Excel。开发者可用`fixtureMapping()`查看映射输入格式；该文件和`fixtureChart`仅为测试，不得用于真实账套。生产表样由`nonprofitFormDraft(code,year)`创建；403开发切片由`cashflow403Template(mapping)`创建，生成前运行`checkCashflow403Sources(svc,period,mapping)`。
