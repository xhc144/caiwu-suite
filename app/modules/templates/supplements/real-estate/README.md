# 房地产开发企业行业预设

对照原版 `w_xt_kgzb_a2/a3/1/3` 与 `docs/original-analysis/data/tables.md` 的 a13 房地产开发常用入口。提供完整 `AccountingTemplate` 合成函数，全部代码仅在本目录；全局登记及真实建账向导由 templates 集成方接入。

- 只读基表：`books-enterprise-cas-2006@2006.18+2026.2`，原生 `4-2-2`，来自既有企业基表的248科目；不跨模块 import，不复制另一套生产基表。调用方传入已登记原生基表，错 ID、版本、方向、父链或追加编码冲突均拒绝。
- 依据[财政部财会〔2013〕17号完整原文（国管局转载）](https://cwfwpt.ggj.gov.cn/zcfg/qykjzd/202306/P020230620583246761887.pdf)第十三条（PDF第4页）、第二十六条（第7—8页），追加七项成本：土地征用及拆迁补偿费、前期工程费、建筑安装工程费、基础设施建设费、公共配套设施费、开发间接费、借款费用。仅符合资本化条件的借款费用进入该成本项；代扣代缴公共维修基金不进入产品成本。第四十三条（第13页）规定共同费用按合理标准分配，模板不自动代做分配。
- `500101—500107` 为应用分配的二级编号，借方、非损益、非备抵、可保留在建余额。`5001` 为父级，必须使用末级并选择真实项目；`4-3-3` 映射为 `5001001—5001007`，原增值税等父链同步逐段映射。项目档案按开发项目、综合开发期数并兼顾产品类型设置，不预造楼盘、银行或往来单位。
- `1405/6001/6401` 要求项目；`1122/1123/2202/2204` 要求项目和客户/供应商。这是应用辅助配置，原文的成本对象/债权债务明细通过既有维度表达，不声称财政部指定软件字段。`2204` 沿用基表的软件编号及[新收入准则](https://www.mof.gov.cn/zcsjtsgb/gfxwj/201707/P020200907398079240429.pdf)第四十一条合同负债；项目/往来不能代替逐合同明细，也不能把收款直接确认为收入。
- 完整输出255科目（203一级、52明细），保留其余基表名称、方向、备抵、双向余额、结转用途及税费专栏。保留 `1405 库存商品`、`5001 生产成本`、`5101 制造费用` 原名称。生产成本下七项明细用于开发成本归集，库存商品通过项目辅助区分开发产品。未声称重建安装包中的全部默认行。

适用范围：执行企业会计准则的房地产开发企业；成本制度自2014年1月1日起适用非金融保险大中型企业，鼓励其他企业执行。本预设固定于2026企业基表版本，不能当作1993旧制度或政府双体系模板。现有建账契约没有本预设的日期校验字段，集成方仍需按说明选择适用年代。

## 导出与接入

统一集成入口为 `export const supplement: TemplateSupplement`，从 `../../preset` 仅导入类型。`supplement.presets` 仅含 `realEstateTemplatePreset`：指定 `baseTemplateId/baseTemplateVersion`，七项 `additionalAccounts`、八项带 `code/source` 及显式 `dimensions` 的 `accountOverrides`，不复制企业基表。唯一集成owner在 `server/supplement-catalog.ts` 导入此 `supplement`；原独立builder保留用于测试与检查，不与preset双重登记同一ID。依赖模板机制提交 `f6c851a9d58e389e259efc0722c49c464ab364d8` 的权威类型和解析器。

```ts
import {
  buildRealEstateTemplate,
  realEstatePreset,
} from '../supplements/real-estate';

// 由已拥有基表/登记处的组合层提供原生 AccountingTemplate；此目录不 import books。
const realEstate = buildRealEstateTemplate(nativeEnterpriseBase);
// templates: [...otherTemplates, realEstate]
// 只登记一次，沿用现有 mapTemplateScheme 接受建账时选择4-2-2或4-3-3。
```

若集成层在已有企业基表登记后组装，可直接使用现有 `registry.register('templates', [buildRealEstateTemplate(registry.get(realEstatePreset.baseTemplateId))])`；不需要新增 core 接口。应在开始提供模板列表/建账服务之前执行，且只由一个 owner 登记此 ID。此调用属于拥有登记处的组合层，不能在本目录跨模块导入 books。

精确签名：`buildRealEstateTemplate(baseInput: unknown, codeScheme?: string): AccountingTemplate`；缺省为 `4-2-2`。输出 ID `real-estate-enterprise`，版本 `1.0.0+base.2006.18+2026.2`。`realEstatePreset` 导出 `baseTemplateId/baseVersion/nativeCodeScheme/supportedCodeSchemes/overrides/append`，供组合层检视；原基表不变。`sources.ts` 导出文件文号、原文URL、生效范围及历史阻塞状态。

## 独立验证

在仓库根运行 `node app/modules/templates/supplements/real-estate/verify.mjs`；使用项目已有 Node24、TypeScript/Vitest，不生成注册表、不改依赖或锁文件。测试的基表适配器仅只读三个已存在的 `books/templates/enterprise*.json`，复现既有 `chart.ts` 的字段转换，生产函数始终要求宿主传入基表。

两种级次均在临时SQLite空账建账，检查科目父链、来源语义、末级/辅助拒绝、失败无凭证、整数分平衡、按项目及往来核账、完工和收入成本结转、重开持久性；性质测试覆盖不同金额和两个项目隔离。所有业务数据为合成资料。这些验证覆盖预设与既有核心契约，不能单独称为真实向导用户功能完成。

## 未完成

- 全局registry和真实向导尚未由本目录接入；由指定集成owner统一接入。未提供自动成本分摊/完工判断/收入确认、逐合同管理、税款计算及法定报表，`reports: []`；业务判断由实际业务与相应模块处理。
- [上海财政2006正式通知及RAR](https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/cwhjjbzdgf/20061201/0017-156907.html)已定位，但web不支持RAR，本环境下载返回HTTP403，未取得本次附件字节。因此不据非官方转载把1405/5001改名，也不新造“5101开发间接费用”法定科目；本目录沿用已授权基表的父科目和来源。
- a14旧房地产：1993年7月1日起施行的财会字〔1993〕2号已由[财会〔2015〕3号第6项](https://www.mof.gov.cn/gp/xxgkml/hjs/201503/t20150302_2512683.htm)明确全文废止或失效，文件日期2015年2月16日，不能采用文告网页9月转载日期。尚未取得含完整科目及使用说明的官方原文，不生成未经核实的历史模板，`historicalRealEstateAvailability.kind === 'blocked'`。
