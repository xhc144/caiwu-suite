# 民非三表（W2-04，未全部实现）

依据 `rules/sources/official/nonprofit-2026.pdf` 第128–153页和 `transition-2025-6.pdf` 第4–5页。对照民非原版“报表管理”菜单及 `w_bb_get/def/proc/saveas`；本目录只提供报表模板与验证，不重做共享引擎、权限或打印界面。

- 基础草稿：`nonprofitFormDraft`提供401资产负债表、402业务活动表、403现金流量表的严格 `ReportTemplateSchema` 表样；该草稿工厂的金额显示“待接入真实取数”。下述取数工厂分别填入已经核验的金额项目，仍明确标记切片，不能作为完整法定报表使用。
- 本次实现：403的2026本年已过账取数切片，显式绑定现金/银行末级账户与24项现金流量分类。捐赠退回冲减原项目，资产处置列净额，内部划转不列收支；金额为整数分。分类依据随模板保存在说明行，不按项目名称猜测分类。
- 本次实现：独立core/testkit固定账套，403逐项手算比对、真实router导入/生成/重算/Excel导出；权限拒绝、失败事务保留快照、漏分类/重复分类/非法内部划转和整数分检查；独立Chromium E2E走现有生成页和真实下载。
- 本次续接：正常合入共享PR112精确SHA `f9b591d68db15dda909923a8b8aa074a62464c8e`，随后正常合入追加精确SHA `a8eb1c0b12e2f9931ae2da3f135f6ceee0bcc826`，没有手改其core/server/shared，不继承旧快照验证数字。401由`balance401AnnualTemplate`真实生成年初和期末全部金额项目，分别保存两时点来源；固定账套年初249000分、期末250000分，1月发生额不污染年初，到期重分类不会复用期末分类回填年初。减值、受托现金移列均由真实科目取数；缺年初期间、范围内部缺月和未结转损益拒绝检查保留。
- 402原合计入口`activity402TotalsTemplate`仍只生成本月/累计D/G列。新增`activity402ClassifiedTemplate`补8项收入、7项费用的B/C/E/F四列及非限定/限定收入和费用小计，D/G沿用原取数；34项零容差审核检查两类之和等于合计。收入贷减借、费用借减贷，使用真实BALANCE第8参数排除pnl，保留退款和自定义转账。每个分类须明确实际末级科目、外部主体/来源/资源批次/具体条款，限定类复用`restriction-evidence`且另有取得或实际使用关联；非限定类须明确核对外部来源未设置限制。普通project、名称、内部决议均不能推断限定性。
- 402分类预检`checkActivityClassifiedSources`拒绝重复、跨类复用、父子重叠、非末级/错类/不存在科目、越出D/G项目范围、分类或合计遗漏实际损益借贷发生额（包括净额0、仅前月发生）、缺期间及含未过账口径。映射要求每个末级在报告累计范围内可归于同一分类；混合批次或中途变更不能直接以期末状态回填全年，须先有可分辨的末级及完整外部依据，尚无逐事件分类系统。来源检查只验证结构、关联声明和账务覆盖，不认定真实主体资格或材料法律效力。
- 402独立合成黄金覆盖全部15×4格且两类均有非零发生、两类小计、退款超过本月发生、自定义转账和pnl结转前后口径，通过真实router生成并读回xlsx；两条独立浏览器流程分别使用结转前/结转后临时账套，不依赖其他模块页面。净资产双向互转、以前年度调整和最终净变动的全部金额格继续显示“待接入真实取数”，没有补0。后续须逐笔关联非限定/限定净资产互转分录（制度3101/3102）、发生时点、资源批次及外部设限/全部解除凭据；以前年度调整须有以前年度净资产调整分录（制度3201）、原期间和调整依据，科目均须按实际账套显式映射，最终净变动须待完整事件及净资产勾稽接通。合成夹具的完整科目表是测试专用，不能把其中5901等虚构编码当成制度编码。
- 本次续接：403由`comparativeCashflow403Template`分别使用本年与上年同期分类来源，实际验证2027累计30000分与2026同期121700分；没有比较来源或期间时拒绝。2026首次例外仍只豁免活动表/现金流量表上年数，不豁免401年初。
- 历史读取：现金账户或现金流量项目停用不使已保存分录失效，报表预检仍读取历史来源；新业务新增引用继续由core拒绝。该项使用实际router生成及新写入拒绝测试，不改变停用状态或共享权限策略。
- 来源条件修正：原算术黄金的“解除/新设审批”已改为明确的虚构外部捐赠者撤销函/双方补充协议，不用内部用途决议认定限定性。参照制度第28–29页第67、69、70条，新增信息完整性拒绝检查：内部决议、缺来源、时间/用途限制未全部解除均拒绝。测试不认定任何真实主体资格或材料法律效力，共享限定性持久元数据仍未实现。

未实现：三张完整法定报表的服务端强制门禁与制度符合性；比较数政策变更调整；业务活动成本自定义组成明细；有适用条件的慈善信托支出/募捐成本取数；跨资源混合分类及逐事件分类引擎、外部主体/真实凭据/法律效力核实；自动分析净资产互转/以前年度调整；受托代理现金和到期分类的自动识别（当前须提供分别复核的明细映射）；现金等价物范围、汇兑影响自动分析、年中启用前分类；多现金项目拆分一条分录、超过4个现金账户及大型401映射的公式预算；报表附注、单位/日期自动填列、完整打印版式与法定模板自动安装入口。此前缺项未删除；只将已经实际验证的年初、跨年比较和排除pnl合计取数更新为已接线切片。

公共接线：401期末/年度、402合计/分类、403首次/比较工厂携带结构化profile，公共generate在同一事务内读保存定义/revision、调用本目录真实校验器并核对账套、固定报告期、posted口径、实际科目及相关分录/期初来源。幂等回放和exportResult同样复核；来源改变、缺guard身份或审核fail/error均拒绝，失败不写新快照且旧结果保留。402分类要求`exclusiveResource:true`专用末级排他声明，服务端持久保存完整实际分录ID/金额/期间/凭证revision及资源/来源/分类清单；必须提供完整`recognitions`逐笔明确确认，逐行包含凭证/分录ID、revision、金额、期间、资源/来源和完整分类依据（含具体条款及取得/使用关联）；缺省、漏行、新行未确认、重复及错配均拒绝，不能从叶子mapping或来源冻结自动生成确认；同末级混合分类拒绝，不按字符串或普通project猜限定性。各工厂标题持续标记“切片”，不作为完整法定报表或生产入口交付。比较/年初公式的明细链接目前还由公共`ViewPage.tsx:211`固定按snapshot.period生成，可能错误穿透；需web owner准确解析options或隐藏该链接，模板owner没有改web。

继承的共享引擎未完成项全部保留：原版S/W/F别名、外币/数量累计、现金流量期初分配、跨账套复制、原版二进制/备份引入、批量粘贴、撤销重做、插删行列、字体/边框/分页/完整套打、任意布尔审核表达式、辅助项穿透及取数追踪、所有关闭路径/草稿冲突恢复、超5000单元格性能、其他制度报表、报税上传及共享桌面打印。不在本目录越界实现。

已收到并实际使用的共享契约：

- 统一使用真实`BalanceFunctionSchema/balanceFormula({原七字段, options})`，第8参数是options的JSON字符串；不新增BALANCEAT/NETACTIVITY，不维护第二套schema或求值。
- from/to支持`current/yearStart/previousMonth/previousYearEnd/previousYearSameMonth/previousYear/previousYearStart/YYYYMM`；previousYear是上年同月。opening取from前期初，closing取to期末，发生额取闭区间，ytd按to年度。401年初用`{from:'yearStart',to:'yearStart',closing:'include',side:'net'}`，期末显式覆盖yearStart至current；403比较用previousYearStart至previousYearSameMonth。缺期间或启用前未知不能按零算。
- 活动表合计使用credit减debit（费用反向），`closing:'excludePnl'`只排pnl；余额保留全部结转。限定性不能由groupBy项目等维度推断，互转/以前年度调整也不以全部借贷相减冒充。原S/W/F别名等缺项保留。

现有公共门禁及后续来源需求：

- 公共generate在其既有`svc.tx`回调里、任何取数和快照写入前，调用`validateCashflow403Generation(transactionalSvc,{period,includeUnposted},guard)`；guard为`{kind:'nonprofit-cashflow403',year:2026,scope:'posted',mapping}`。包含完整映射，必须持久保存并与模板绑定，不能从说明文字还原，也不能在copy/save/import时静默卸掉。
- 比较现金流调用`validateComparativeCashflow403Generation(svc2,input,{current,previous})`，两年各有来源且预检本身检查范围缺月；401年度调用`validateBalance401AnnualGeneration(svc2,input,{closing,opening})`，明确拒绝含未过账、错误年初时点与范围缺月；402合计对应`checkActivityTotalsSources`，分类对应`checkActivityClassifiedSources(svc2,input.period,mapping,{includeUnposted:input.includeUnposted})`。这些函数由唯一公共profile注册点在generate事务内调用，HTTP反例同时检查绕过UI的请求。分类映射持久绑定模板，copy/save不能卸掉guard或改写已绑定公式/审核；说明行不能代替profile。公共exportResult强制拒绝失败审核和来源失配。
- 需要结构化、带来源的重分类输入：到期日/受托现金明细/各类减值分配/比较数调整/净资产转限制/以前年度调整/现金等价物政策及汇兑影响；无来源时阻止生成。年初受托现金和到期分类须按年初状态，不能拿期末分类回填。
- 共享生成入口需要同事务校验年度、适用制度、仅已过账、逐笔现金分类覆盖及内部划转；需保存分类依据、取数期间和预检来源版本，防止预检后账务变化。2026比较例外只豁免两张表的上年数。

试用：在`app`下运行`pnpm exec vitest run modules/report-engine/test/nonprofit`；设置`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`后运行`pnpm build:web`和`pnpm exec playwright test modules/report-engine/e2e/nonprofit --retries=0`。浏览器流程会自行建临时民非企账套、用testkit造数据、调用真实`router.importTemplate`，再打开现有生成页并下载Excel。开发入口为`balance401AnnualTemplate`（两时点来源）、`activity402TotalsTemplate`（合计列）、`activity402ClassifiedTemplate`（收入费用四分类列）、`cashflow403Template`（2026首次执行）、`comparativeCashflow403Template`（本年/上年同期）。相关fixture与虚构依据仅供测试，不得用于真实账套；这些入口均不是完整生产制度报表安装入口。外部材料真伪、主体资格和法律效力仍由人工核实，程序不提供法律认证。

403两个工厂均要求第二参数为明确的固定报告期，例如`cashflow403Template(mapping, 202602)`或`comparativeCashflow403Template(mapping, 202702)`；不会在首次生成时猜月份。新工厂产物为`mode:declaration`的显式来源确认；保存/导出文件为`mode:bound`并保留原账套/来源印记，换编码重导入不能刷新已失效分类。
