# 可验证的会计制度参考数据包

基线：`97d696a3ee7adf100e24b4924438468bd34dd80c`；证据截止：2026-10-25；数据版本：`2026.10.25.1`。本包只写 `rules/**` 与 `tests/Caiwu.Rules.Tests/**`，不修改共享契约、账务内核、桌面端、SQLite 或根 solution。

这是官方资料的可核验结构化快照和自研验证工具。**所有包 `isVerifiedForProduction=false`；完整报表、真实账务处理及财务合规均未验收，不能保证高风险真实财务合规。** 官方制度已经生效与本软件已经实现是两个独立事实。

## 覆盖范围

| 包 | 科目数据 | 报表数据 | 边界 |
|---|---|---|---|
| 小企业 | 正式2011附录66项一级代码/名称快照；5403名称采用财会〔2016〕22号的“税金及附加”更名，保留原名和出处 | 三表及附注元数据；货币资金、固定资产净额、营业收入、管理费用代表行；利润/现金流量月报与年报列变体 | 66项不等于全部法定可选科目、明细科目或2026全部累计专项规则；不实现税务、全部计量、成本分配、完整报表 |
| 民非 | 财会〔2024〕25号正式附录56项一级代码/名称完整快照，2026-01-01生效 | 三表及附注元数据，收入和费用的限定/非限定两类代表行；月/季/半年列元数据；年度完整比较列变体标未实现 | 没有发明“法定明细编码”；5601所得税费用细节需专业复核；完整结转、重分类、报表和旧账迁移未实现 |
| 企业 | 9项工程样例；数字编码均未用正式现行指南全文核验。5项名称也标为未核验工程示例，其余4项名称可由2019附件2核对 | 财会〔2019〕6号附件2四表名称、期间、列元数据；不提供行取数公式 | 仅执行新金融、收入、租赁准则且未采用2026新第30号的非金融企业个别报表；不覆盖金融、保险、合并或全量现行科目 |

三包的代码、科目语义、范围、报表及民非分类元数据分别维护。不能把它们当作换显示名称的一套模板。`normalDirection` 是初始化通常方向，**不是禁止反向余额或冲销分录的规则**；备抵资产为贷方通常方向。

所有包当前只声明支持2026-01-01及以后的参考期。小企业法律原始施行日另存2013-01-01，不能因本包支持范围较窄而改写制度生效日。旧期间不自动套用本次快照。

## 文件与核验

- `catalog.json`：现行可选参考包、正式未来分阶段规则和草案的独立状态，以及包文件SHA-256。
- `packages/*.json`：版本、适用资格、生效/支持区间、来源定位、科目、报表元数据和限制。
- `sources.json`、`sources/official/*`：官方原始附件或官方网页快照及SHA-256、字节数；未取得原始字节的来源明确用空hash，不伪造归档。
- `migrations/nonprofit-2004-to-2026.json`：8项有出处的候选/禁转/人工分类样例，同码异义清单；完整迁移和自动迁移两个标志均为false。
- `schema/*.schema.json`：JSON Schema 2020-12。`runtime.py` 额外校验跨字段关系与证据引用，`validate.py` 为离线入口。

基线约定所称的 `docs/rules-source/unpacked` 三份研究没有被跟踪到指定提交，远端也返回404。按该约定中记录的Library身份取回同SHA-256研究ZIP，完整阅读后按其官方链接定点核验；三份研究hash记入 `sources.json`。没有重复广泛法规搜索、下载或运行原商业软件。

```bash
python3 -m pip install -r rules/requirements-validation.txt
python3 rules/validate.py
python3 -m unittest discover -s tests/Caiwu.Rules.Tests -p 'test_*.py' -v
```

验证依赖仅Python和固定的 `jsonschema==4.26.0`，不依赖UI、SQLite、网络或.NET。原始PDF提取时使用的pypdf不是运行或测试依赖。当前执行环境没有dotnet，因此没有声称运行.NET10测试或验证桌面端集成。

## 给主协调的接入API

本次不改 `TemplateCatalog` 或任何共享接口；以下是规则数据边界，主协调可在自己的目录实现.NET适配器。Python辅助入口全部只读：

```python
from rules.runtime import (
    select_package, load_bundle, evaluate_sample_row,
    nonprofit_closing_route, migration_candidate,
)

package = select_package(
    "Nonprofit", "2026-10-25", "EligibleNonprofit",
    eligibility_confirmed=True,  # 调用方必须已记录主体资格证据，不能从名称猜
)
target = nonprofit_closing_route(
    package, "5301", "Restricted", evidence_kind="ExternalProvider"
)  # 返回3102，仅为复核路由，不生成或过账凭证
```

`select_package(regime, on, profile, eligibility_confirmed=False, early_adopt_cas30=False)`：不确认资格、无唯一适用版本、未覆盖日期或主体即抛 `RuleError`。Enterprise三个profile是 `DualListedOrSpecifiedOverseas`、`OtherDomesticListed`、`NonfinancialUnlisted`；前者限通知所述境内外同时上市及采用IFRS/企业准则编报的指定境外上市主体。小企业和民非分别为 `EligibleSmallBusiness`、`EligibleNonprofit`。

新第30号按主体2027/2029/2030年起强制，允许提前。传入提前执行选择或到相应强制期时，本实现抛出“适用但未实现”，不回退2019表样。`catalog.json` 中正式未来项与2026科目征求意见项都不可选；草案无正式生效日。规则选择按会计/报告期和明确执行选择，不按安装日期或最新文件年份。截止日后的选择仅沿已核正式安排推导，不保证未来没有新增规定。

映射到现有 `Caiwu.Contracts.TemplateDefinition` 时，建议：

1. 保存规则包 `id`、`version`、文件SHA-256和适用性确认；`TemplateVersion`须能定位这一不可变快照，不覆盖旧账制度。
2. 科目按 `code/name/parentCode/normalDirection`生成DTO；金额期初由用户独立录入，默认零；生产验证标志始终false。只向UI提供已披露为参考/实验的模板。
3. 现有 `VoucherLine` 没有限定性、限制证据、结转类型等字段，不能因此宣传民非完整核算已经接入。增加维度或等价可追溯明细需主协调扩展契约后另测；本任务没有改接口。
4. 企业样例编码不能作为已验证法定种子；财务报表元数据不能直接作为完整计算器。企业管理费用含研发等需明细分析，本包特意不提供简单整科目公式。
5. 所有错误要显式展示，不吞掉后继续使用其他制度、草案、旧版本或零值。

`evaluate_sample_row(package, report_id, row_id, facts, restriction=None)` 只计算已列代表行。`facts`每项必须含 `accountCode/measure/restriction/value`；value为两位以内十进制字符串，借正贷负，禁止float、指数、非有限值及溢出。`measure`为 `closing_net_debit`（期末借贷净额）或 `period_net_debit`（未含损益结转的期间借贷净发生额）。不存在的输入明确报错，不把缺失比较数或未分类金额填0；父科目事实须由上游汇总，不能同时累加父子。

`columns`表示附件的印制基础列。存在 `columnVariants` 时按其期间元数据解释，`UnimplementedPresentation`不允许作为完整渲染模板。2026民非首次比较例外另有字段，不能延伸到2027或默认为上年金额为0。

`nonprofit_closing_route` 对收入及费用分别按明确分类指向3101/3102；受限证据来自外部提供者或法律/行政法规，内部预算本身不够。支出不自动生成旧法使用重分类。5601被标为 `ReviewRequired`：专门说明PDF124—125页仅展示转3101，而一般分类/报表说明PDF146页又要求区分两类；自动路由阻断，留会计师复核，不擅自宣称“所得税只能非限定”或已支持限定性税费。

`migration_candidate(migration, from_version, code, name, balance)`同时匹配旧制度版本、旧编码、旧名称，只返回 `isExecutable=false` 的工作底稿候选。旧1701受托代理资产→新1801，不能按同码进新1701长期待摊费用；旧5201/5301/5401为管理/筹资/其他费用，新码分别5301/5401/5901。费用对应只用于新年科目语义参考，旧余额非零即阻断，不能搬入2026损益。文物文化资产分类、长期投资、明细拆分、补记调整等尚需人工分析。此API不写账、不完成迁移，也不以余额平衡冒充完整迁移已验。

## 尚未取得或未完成

企业现行完整科目及账务处理指南出版物、2026第30号完整配套新表样、累计解释逐项清理、GB/T24589.1-2024获授权全文、十类电子凭证标准字段和流程、档案/税务/行业地方规则符合性均未完成。官方接口全文平台明示版权限制，本包只存版本、替代关系与限制说明，**没有“符合2024数据接口”声明**。JSON校验或CSV导出不能代替这些验收。

源获取限制：财政部2026第30号主通知HTTP502，分阶段日期以辽宁财政厅正式全文转载核验；上海财政局2016更名网页经web工具读取正文，本地原始字节请求HTTP403，未重试/绕过，故该来源hash为空。不存在审批拒绝或未明结果的远端写入。发生官方规则与本数据冲突时，以正式原文及有权机关解释为准，并按新版本更正，不改历史快照。
