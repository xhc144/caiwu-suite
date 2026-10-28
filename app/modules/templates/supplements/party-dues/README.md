# 党费专账预置

对应原版 `a46.acd`「党费管理模板」的行业缺口，服务于 `w_xt_kgzb_a2` 行业选择、`w_xt_kgzb_a3` 科目级次与 `w_xt_kgzb_3` 新建账套科目生成。原版对应关系只取自 `docs/original-analysis/data/tables.md` 的静态 aclist 摘录；没有读取或执行安装包、原账套，不能称为原 a46 科目表的逐项恢复。

当前可供接入的是 **济航〔2021〕30号列明单位的党费独立专账口径**，不是全国统一党费会计制度。名称保留这个限制。文件第十三项规定自发布日 **2021-04-30** 施行；官方网页的有效性、失效日期栏均为空，截至 2026-10-28 的核读不构成对当前持续有效性的法律确认。应用将此参考预置标记为 `status:deprecated`，表示不作为现行默认选项，并不表示已查获官方废止文件。建账入口必须展示名称、description 和参考状态，且只供核实适用该文件的单位选择，不作为所有党组织的默认制度。

## 官方来源与数据边界

| 原文 | 本预置采用的内容 |
| --- | --- |
| [济宁市港航事业发展中心党费会计核算办法，济航〔2021〕30号](https://www.jining.gov.cn/art/2021/4/30/art_59679_2722747.html) | 第六项（一）（三）（四）（五）：人民币、收付实现制、指定用途单独核算、借贷记账；第七至八项：五个类别、14 个一级科目名称、4 个支出明细名称；第十三项：生效起点。发布机关全文，不采用第三方摘要。 |
| [中央组织部《关于中国共产党党费收缴、使用和管理的规定》原文](https://news.12371.cn/2016/08/25/ARTI1472088836873972.shtml) | 第二十三至二十四条：会计出纳分设、参照行政单位会计制度、党费独立银行账户、利息及投资限制；第三十二条：2008-04-01 起施行。它没有给出全国统一党费科目编码。 |

第八项**没有提供编号、方向或辅助配置**。JSON 的全部编号均是版本化的应用预置，不是从 a46 恢复的编号，也不冒称法定编号；余额方向按借贷记账的资产/支出借方、净资产/收入贷方作应用映射，党费结余允许双向余额。每个科目的 source 逐项说明原文名称与应用映射。`其它收入` 保留原文用字。文件只列负债类别而未列负债科目，本预置保留空类别，未自行补入暂存款、应付款等名称。

未从“参照行政单位会计制度”推导出旧行政制度目前仍有效；也未把《政府会计制度》的单位本体双体系简化成这张表。该地方文件自身第六至八项规定了收付实现制和五类党费专账科目，故本预置仅实现这个独立专账。若目标是行政事业单位本体或代管党费，必须另选对应制度，不能用此预置代替财务会计与预算会计。

## 科目与现有能力的映射

| 应用编码 | 原文名称 | 显示方向 | 辅助（应用映射） |
| --- | --- | --- | --- |
| 101 | 现金 | 借 | 现金日记账标志 |
| 102 | 银行存款 | 借 | 银行日记账标志，不预设真实银行账户 |
| 103 | 有价证券 | 借 | 无；科目存在不授权购买国债以外的投资 |
| 104 | 暂付款 | 借 | 必填项目、统一往来对象 partner |
| 106 | 固定资产 | 借 | 无；不生成折旧或资产卡片 |
| 301 | 固定基金 | 贷 | 无 |
| 303 | 党费结余 | 贷（余额可双向） | 必填项目 |
| 401 | 党费收入 | 贷 | 必填项目 |
| 402 | 上级补助收入 | 贷 | 必填项目 |
| 403 | 党费利息收入 | 贷 | 必填项目 |
| 404 | 其它收入 | 贷 | 必填项目 |
| 501 | 党费支出 | 借 | 必填项目；有下级，不可直接制证 |
| 50101 / 501001 | 党员培训费 | 借 | 必填项目 |
| 50102 / 501002 | 党员教育费 | 借 | 必填项目 |
| 50103 / 501003 | 党内表彰费 | 借 | 必填项目 |
| 50104 / 501004 | 生活困难党员补助费 | 借 | 必填项目 |
| 502 | 补助下级支出 | 借 | 必填项目 |
| 503 | 上缴党费支出 | 借 | 必填项目 |

项目用于分别登记普通党费和每个指定用途资金，收、支及结余沿用同一项目，以现有项目余额/明细查询分开核对。暂付款用同一个 partner 类型登记债务单位或个人，避免强制一笔业务同时填单位和个人。项目和往来对象为应用实现选择，文件未指定这些数据库维度，也没有要求所有普通收入均必填项目。模板不创建任何实际党员、组织、专项、银行、期初余额、留存比例或上缴比例；使用单位建账后先维护自己的辅助档案。三张专门报表未随本预置交付，项目账不能直接称为这些报表已实现。

收入、支出 `isPnl:false` 且科目 `closingRule:'none'`，防止现有企业损益结转将党费转进本年利润或每月清空。普通保存、审核、过账及余额查询可复用 core。专属年末结转与报表仍须后续实现，不能把本数据包称为完整党费管理用户功能。

## 导出与 registry 接入

从本目录 `index.ts` 导出：

```ts
const PARTY_DUES_CODE_SCHEMES: readonly ['3-2-2', '3-3-3'];
type PartyDuesCodeScheme = '3-2-2' | '3-3-3';
function getPartyDuesTemplate(scheme?: PartyDuesCodeScheme): AccountingTemplate;
function parsePartyDuesTemplate(input: unknown): AccountingTemplate;
const partyDuesTemplates: readonly AccountingTemplate[];
const partyDuesSupplement: { /* 精确类型由 TypeScript 推断，见 index.ts */ };
const supplement: TemplateSupplement = { templates: partyDuesTemplates };
```

这是独立模板，`baseTemplateId:null`、`baseVersion:null`，**无企业/行政/民非基表合并步骤**，无跨模块 import。模板 ID `party-dues-jining-port-2021`，版本 `1.0.0`。`getPartyDuesTemplate()` 每次返回独立副本，先做 core 结构检查，再保护该版本的名称、方向、类别、辅助及结转配置；不写 registry 或账套。

统一契约来自 `wave3/templates-completion@f6c851a9d58e389e259efc0722c49c464ab364d8` 的 `modules/templates/preset.ts`，本目录仅 `import type`，不复制实现。由唯一 registry owner 在 `modules/templates/server/supplement-catalog.ts` 中汇总本目录的 `supplement` 导出，沿该 owner 的解析/注册链路接入一次。不要同时再追加 `partyDuesTemplates`，避免重复注册。这里是独立专账，没有企业基表，不生成企业 preset；`supplement.presets` 省略。

只能注册默认原生 `3-2-2` 一份；`3-3-3` 是建账 `codeScheme` 参数，由现有 `mapTemplateScheme` 逐段映射，不能把同 ID 的两方案重复注册。JSON 也能经 core `parseTemplate` 读取；推荐使用导出函数以保留本版本的额外配置保护。源版本写入科目 provenance，后续升级不会自动改旧账。接入后仍须由 owner 验证真实向导上的范围说明、选择、建账及登录，不能以本目录的核心服务测试替代完整页面流程。

## 独立测试入口

可从仓库根目录执行 `node app/modules/templates/supplements/party-dues/run-tests.mjs`；入口只调用原锁已安装的 Vitest，从任意当前目录均可运行。

在 `app/` 下使用 Node 24、仓库规定的 pnpm 10.28.0 和原锁依赖：

```sh
pnpm exec vitest run modules/templates/supplements/party-dues/test
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec eslint modules/templates/supplements/party-dues
pnpm exec prettier --check modules/templates/supplements/party-dues
```

测试中原文期望名称表独立于被测 JSON；两级次真实临时 SQLite 建账、方向/父链/末级、辅助拒绝与正式制证、期初及过账后余额、专项隔离和整数分守恒均在此目录，不依赖 registry owner 的未合并代码。拒绝重复编码、缺失父级、非法级次、错方向、错辅助和不平衡凭证。所有单位、金额、项目、对象均为合成。

## 未完成

- a46 原始科目内容及编码不可从已授权静态清单中获知；未进行原安装包/真实账套读取。
- 全国统一、可以无范围限制默认提供的党费完整科目制度尚无本次已核原文支持；不能用地方文件填平这个证据缺口。
- 该文件在具体使用单位截至建账日的持续适用性，需该单位依实际有效制度核实。
- 资产负债表、收入支出表、净资产变动表、资产卡片、专属年末结转、业务审批/报销、真实向导接入及 E2E 不在本目录实现范围。
