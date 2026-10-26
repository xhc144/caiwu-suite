# 小企业三表（W2-03）

依据 `rules/sources/official/small-appendix.pdf` 第68—85页及编制说明，保留原文项目名。本目录仍是未完成的取数切片，不是完整法定报表。原版入口：`w_bb_main` 报表管理、`w_bb_get` 引入、`w_bb_def` 定义、`w_bb_proc` 生成、`w_bb_saveas` 导出。未读取旧C#或重新解析安装资源。

功能清单：

- `301.json`（code301）：53项行次，30项接真实取数；28项简单余额/备抵净额加应收、应付两项重分类。先按末级科目及往来对象分借贷再汇总，贷方筛选返回正数；期末和年初分别计算。预付借余、预收贷余因缺期限分析仍留缺项。简单项目年初用期末减本年借方累计加本年贷方累计，已核对跨月、年中启用及年结储存期初；新增方向重分类的年初取数要求存在年初期间。
- `302-monthly.json` / `302-annual.json`（code302）：32项行次，默认13个主项/合计接真实结转前净发生额。月报本年累计/本月，年报本年累计/上年全年；上年固定 `previousYearStart` 至 `previousYearEnd`，不使用上年同月。只排 `closing_kind='pnl'`，保留其它结转、退货、冲减、投资损失及利息收入。原文3项利润合计审核已接通。
- `extendedIncomeTemplate(mode, details)` 可按明确的真实明细科目映射填齐32行及6组“其中项”包含关系审核；映射必须属于对应母科目且不能重复或上下级重叠。默认JSON没有猜测19个明细项目的二级编码，它们仍显示“未实现”。明细映射的用户配置入口尚未实现，不能把测试账套配置当作正式账套已有配置。
- `303-monthly.json` / `303-annual.json`（code303）：22行月报及本年/上年全年取数，现金范围1001/1002/1012。现金分录的SBxx分类取净额；内部转存SB_INTERNAL不计三类活动；退款冲减原类，处置费用抵减行10，资本化借款利息列17、工程人员工资列4。借贷分类金额、内部转存、期末总账共8项核对。年、月版本同code，不能同时引入同一账套。
- 全部JSON使用实际 `ReportTemplateSchema` 和共享 `balanceFormula`，通过真实router导入、生成、模板导出、xlsx导出；只读模板、整数分、未过账确认、权限和失败后保留上次快照均保留。三表表内、名称及导出均保留未完成/试算标记。
- 测试经core/testkit造合成数据，不依赖本波页面。固定黄金值含结转后本年利润9696分/上年14098分、非损益结转501分保留、按往来分方向余额、两年现金期末466384/274397分，以及显式明细映射32行逐格手算。E2E只经core接口选基线已有小企业科目表、core/testkit造数、报表页真实引入/生成/刷新/下载。

未完成项（完整三表目标尚未完成）：

- 301：预付借方/预收贷方的期限分析及重分类；超过一年和一年内到期的资产负债；存货/在产品、长期债券、长期待摊、递延收益及其它流动/非流动项目分析；实收资本分析、中外合作已归还投资、结转前利润/未分配利润、各级完整合计、资产负债平衡和存货包含关系审核。
- 302：正式账套的费用/税费等19项明细映射及配置页面；原文已停用税费名称保留于历史表样，后续税制更新未完成；年报12月生成限制尚无服务端模板策略。显式映射下的全32行不等于所有账套都已具备这些明细。
- 现金流量：逐现金分录漏分/无效分类阻止、受限资金排除、现金范围配置、启用前本年项目分配。金额汇总核对不能替代逐分录完整性；当前引擎审核失败仍能生成和导出，故仍为试算。首年无上年、启用前无可靠结转依据、缺期间均明确报错，不填零；首年“不适用”列的用户表达仍缺。
- 公共页面的比较期/区间明细链接仍需web owner按options解析，当前固定生成月；不能按该链接核对上年明细。本分支不修改web/F8。
- 动态单位/日期、签章、打印分页和完整格式；附注第82—85页的遵循制度声明、短期投资/应收账龄/存货/固定资产明细、职工薪酬和税费明细、利润分配表、担保/诉讼、持续经营、纳税调整及其它披露。
- 父模块README原有缺项继续保留：原版函数别名、外币/数量累计、现金流量期初分配、跨账套/二进制导入、完整编辑与打印、任意布尔审核、取数追踪、统一关闭确认、性能优化、报税上传等，未因本切片完成。

共享契约及仍需的共享改动：

- 正常合入唯一共享owner PR112精确提交 `a8eb1c0b12e2f9931ae2da3f135f6ceee0bcc826`（包含原f9b591d及7f5975），未手改其core/server/shared。统一 `BALANCE` 原7参加可选第8个JSON字符串，由实际 `BalanceFunctionSchema` / `balanceFormula({原七字段, options})` 编码；不另造API。
- `from/to` 用current、yearStart、previousMonth、previousYearStart、previousYearEnd、previousYearSameMonth/previousYear或YYYYMM；opening为from前期初，closing为to期末，发生额为闭区间，ytd按to年度。`closing:excludePnl`仅发生额排真实pnl；余额不排结转。`side:debit/credit`先按末级及groupBy辅助项取正数，再汇总。
- 仍需owner提供审核失败/错误阻止正式生成及导出、原子模板预检、逐现金分录分类完整性及现金范围/启用前项目分配、期限/到期日分析数据、年报期间策略。不得用IF除零、缺科目、未知来源或假零替代这些能力。

试用：在小企业科目账套的报表管理引入本目录JSON；年/月版本选其一，需要并列比较先复制换码。302默认可试主项，明细格明确留缺；只有提供真实明细映射的生成器输出才有全部32行。303先建立catalogue.ts的16个SBxx和SB_INTERNAL并在现金分录填写，缺科目/项目会报错。年报选12月，导出核对“口径与审核”；任何核对失败停止使用试算结果。共享期间函数缺少历史期间或可靠启用前来源时会拒绝生成。

从app运行 `node --import tsx modules/report-engine/templates/small-business/write-templates.ts` 更新JSON。专项：`pnpm exec vitest run modules/report-engine/test/small-business`；先构建web，再用仓库变量 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` 跑 `pnpm exec playwright test modules/report-engine/e2e/small-business --retries=0`。全量为 `pnpm check`，CI置空保证零retry。
