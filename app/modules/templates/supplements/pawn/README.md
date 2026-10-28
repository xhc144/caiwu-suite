# 典当企业科目预设

对照原版静态清单 `docs/original-analysis/data/tables.md`：a33.acd，顺序23，名称“典当行模版”；对应行业选择 `w_xt_kgzb_a2`、信息确认 `w_xt_kgzb_1`、一键初始 `w_xt_kgzb_3`。未读取安装包或真实账套。

- 接入导出：`supplement: TemplateSupplement = { presets: [pawnPreset] }`。生产代码从 `../../preset` 仅import type，基于owner固定提交f6c851a9的契约，不复制或读取books基表。
- `pawnPreset: TemplatePresetInput`：`pawn-enterprise-cas-2021@2026.10.28.1`，基表为 `baseTemplateId: books-enterprise-cas-2006`、`baseTemplateVersion: 2006.18+2026.2`；追加20项，覆盖17项，合成后268科目。
- `buildPawnTemplate(baseInput: unknown, scheme?: PawnCodeScheme): AccountingTemplate`：保留的独立核对入口，必须显式传入只读基表；支持4-2-2、4-3-3。正式接入由既有preset机制合成，随后建账参数统一映射级次。例如13030101→1303001001，父科目130301→1303001。
- `pawnApplicability`：2021-01-01起账期、原版显示名称、两个编码方案及当前功能限制。`pawnSources`、`pawnAccountingNotes`：官方法规正文链接及适用年代。

集成owner只需在 `server/supplement-catalog.ts` 从 `../supplements/pawn` 导入 `supplement`，加入 `supplements` 一次；不要另行注册独立builder的结果或企业基表。无需修改core、registry、books，也无需新增API。基表更版应先复核；preset机制会检查 `baseTemplateVersion`。

父科目1303/1304/1471/6011等沿用现有企业基表的名称、类别与方向，只在其下追加行业明细。1409使用财会〔2009〕11号指定编号；其余新增明细编号由软件分配，未冒充统一法定编号。贷款和减值分户使用现有客供辅助记录当户、项目辅助记录当票/合同；绝当存货及跌价准备按项目追踪。辅助必填为软件分户配置，不宣称法规指定这些维度。未预置演示档案、初始余额或数量单位。source-only覆盖项不携带dimensions，避免清空基表原维度。

本预设适用于2021年起执行2017金融工具准则的典当企业，未另造“典当会计制度”。2009首次执行及旧金融工具分类不作为2026年默认处理；旧1501/1502/1503在该新账预设禁用。综合费纳入贷款实际利率，不能重复转入手续费收入；1409仅承接符合资产定义和确认条件的存货类绝当物，不登记一般在押当物或金融资产类绝当物。

财政部2009通知正文可读，原DOC直取403；逐条核对了商务部政府网站转登的法规全文，该网页标明北大法宝来源。没有声称下载核验原DOC，不使用第三方摘要或该站效力元数据作依据。原附件、法规全文、后续金融工具/收入准则及监管原文链接见sources.ts；2026科目修订征求意见稿未用于定义。

独立检查入口（app目录，Node24、pnpm10.28.0）：

```sh
pnpm exec vitest run modules/templates/supplements/pawn modules/templates/test/preset.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec eslint modules/templates/supplements/pawn
pnpm exec prettier --check modules/templates/supplements/pawn
node scripts/check-boundaries.mjs
```

测试夹具只读现有enterprise/enterprise-updates/enterprise-details三个JSON，按既有字段语义转换，不跨模块import、不保留完整副本。测试包括真实preset解析合成、覆盖时保留维度、两种级次的父链/方向/备抵/双向利息调整、临时SQLite期初/当户当票辅助、放款/综合费/收息/还本/已确认的绝当存货及跌价处置/贷款减值、过账汇总及重开。拒绝重复、错误方向或版本、非法父链、上级制证、缺少/错类型辅助、旧分类制证和不平衡凭证；fast-check检查整数分守恒。

未完成：实际建账向导接入由集成owner负责，此目录自身尚未注册，不独立声称完整用户功能。没有典当专用当物备查簿、逾期账龄、会典报表及附注、自动实际利率/税费计算、当票业务单据或历史迁移。临时合成测试不是原版实机验收。
