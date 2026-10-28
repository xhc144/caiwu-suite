# 融资担保与小额贷款行业预设

对应原版 `w_xt_kgzb_a2` 行业选择的 a16「投资担保行业」、a32「小额贷款企业模板」，以及 `w_xt_kgzb_a3/1/3` 科目级次、信息确认和新建科目数据。只提供新建账套预设和独立合成测试；真实建账向导由 templates 集成 owner 接入。

| 预设 ID（版本均为 `2026.1.0`） | 适用范围 | 增补及辅助 |
| --- | --- | --- |
| `financing-guarantee-cas22-2026` | 财务担保合同金融工具口径，非指定为公允价值计入当期损益的合同 | `280101 财务担保合同`，客户及单项合同必填；存入/存出保证金按往来单位辅助 |
| `financing-guarantee-cas25-2026` | 已明确视作保险合同、已按保险合同核算且按单项合同不可撤销选择该准则的相关合同 | 继承新保险合同13项科目，项目辅助代表合同组；不能用单个客户代替合同组 |
| `microloan-enterprise-cas22-2026` | 企业准则下符合摊余成本分类条件的普通贷款 | `130301 本金`、`130302 利息调整`、`130303 应计利息`；客户及合同必填；1132仅用于已到期可收未收息；1304为贷方备抵 |

三套均以已注册的 `books-enterprise-cas-2006@2006.18+2026.2` 为只读基表，不复制基表、不跨模块 import。基表原生级次为 `4-2-2`，先合成再用 core 映射到 `4-3-3`，例如 `130301→1303001`、`280101→2801001`。一级父科目不变；二级编号均明确为软件明细编号，不冒称财政部固定编码。合成后分别249、248、251项，含保留但停用的旧科目。

三套覆盖金融企业的 `6601 业务及管理费`，保留未指定修改的辅助项；每项 override 均有独立 `code+source`。旧金融资产分类、旧保险合同科目停用；金融工具口径停用新保险合同科目；三套停用吸收存款，融资担保预设停用自营贷款。继承基表中的其它行业备用科目不表示取得经营许可，也不为实际机构自动判定业务资质。

依据在 [sources.ts](./sources.ts) 和每项 `source` 中，均指向财政或监管机关原文。关键范围为财会〔2017〕7号金融工具准则、财会〔2020〕20号及财会〔2025〕12号保险合同准则、财政部2021年财务担保/预期信用损失问答、2023年金融费用问答，以及财会〔2019〕6号利息列报说明。辽宁2009小贷范本只核行业科目和明细名称，后续计量改按现行准则；2005担保办法只说明原版历史，不能作为2026融资担保默认制度。小贷不使用小企业准则。

集成只需从本目录 [index.ts](./index.ts) 取得以下导出，再由 owner 的 `server/supplement-catalog.ts` 收集：

```ts
export const supplement: TemplateSupplement; // { presets: guaranteePresets }
export const guaranteePresets: readonly TemplatePresetInput[];
export const baseTemplateId = 'books-enterprise-cas-2006';
export const baseVersion = '2006.18+2026.2';
```

类型仅从 `../../preset` 导入，契约为 owner 提交 `f6c851a9d58e389e259efc0722c49c464ab364d8`。不需要修改 core；生产由 owner 的 `resolveTemplatePresets` 合成。`composeGuaranteePreset(presetId, baseInput, scheme?)` 只用于本目录独立验证，调用方必须显式传入基表；`guaranteeApplicability` 另给出原版映射、生效日和选择条件。测试只读现有企业 JSON，未导入 books 代码。

独立测试入口（在 `app/` 下，Node 24、pnpm 10.28）：

```sh
pnpm exec vitest run modules/templates/supplements/guarantee/test/guarantee.test.ts
pnpm exec tsc -p modules/templates/supplements/guarantee/tsconfig.json --noEmit
pnpm exec eslint modules/templates/supplements/guarantee
pnpm exec prettier --check modules/templates/supplements/guarantee
```

类型检查须已包含 owner 的 `preset.ts`。测试涵盖三预设×两级次的临时SQLite建账、期初、制证及过账、末级和辅助拒绝、贷款应计/到期/收款、备抵及担保负债余额、父级汇总、重开一致性、随机借贷往返和不平衡拒绝。数据均为合成，不代表保险或信用损失计量模型。

未完成：本目录未修改或验收真实向导、registry/catalog、已有账套迁移、首次准则转换、信用风险三阶段估计、保险合同分组/计量、法定报表。2026适用范围和保险口径选择条件已写入预设说明及元数据，但 core 尚未强制限制建账年份或核验单项合同选择；集成 owner 需要在实际向导中呈示和处理，不能把当前数据导出称作完整用户功能。混用两种合同计量口径的机构需逐合同判断，本次未提供自动混合口径分流。
