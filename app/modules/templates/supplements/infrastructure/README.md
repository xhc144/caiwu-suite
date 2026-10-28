# 基本建设补充

对应原版 `w_xt_kgzb_a2` 行业选择的 a12“基建企业”和 a15“国有建设单位”，只提供模板合成与独立验证，不登记 registry，不修改 books/core。来源及适用范围集中在 `sources.ts`，不读取安装资源、真实账套。

- `buildEnterpriseInfrastructureTemplate(base: unknown, codeScheme?: string): AccountingTemplate`：调用方提供只读 `books-enterprise-cas-2006@2006.18+2026.2` 原生4-2-2基表。校验1002、1601、1604、1605的名称、类别、方向、核算属性；只覆盖1604项目辅助，追加160401—160404四项明细，其余基表逐项保留。返回完整可注册模板 `enterprise-infrastructure-cas@2006.18+2026.2+infrastructure.1.0.0`。支持4-2-2、4-3-3；推荐注册原生4-2-2，建账参数再让core映射。基表已有工程明细或版本变化时拒绝合成，不吞掉冲突。没有跨模块 import。
- `enterpriseInfrastructurePreset`：导出 `baseTemplateId`、`baseVersion`、`overrides`、`append`、两种级次及来源。明细名称取官方原文，应用预设不宣称国管局系统编码规则适用于全国企业，也不把企业基建称作独立新会计制度。
- `infrastructureHistoricalTemplates: readonly [AccountingTemplate, AccountingTemplate]`：1996原始版125项（46总账、79具名明细）；1998补充版130项（49总账、81明细），均 `status:'deprecated'`。后者将302改为项目资本、取消30109、调整10312财政贴息核算，并以明确的软件编号105/106/308追加原文未编号科目；不重编303企业债券资金。
- `assertInfrastructureHistoricalPeriod(templateId: string, startYear: number): void`：历史选择提交前调用。1996版限定1996—1997，1998补充版限定本包1998—2018；这是应用提供的范围，不是宣告原制度对所有主体的废止日。不能在2026默认列表中以“现行基建”展示。
- `governmentInfrastructureReference`：独立财务/预算会计子集、1613六项明细及建筑/安装子明细、预算功能/经济分类要求。`allowBookCreation:false`；`requireGovernmentInfrastructureBook(): never` 返回具体阻塞。不得把子集摊平注册。`checkGovernmentInfrastructurePair(...)` 只核对合成案例各体系的整数分、末级、项目和独立平衡；不写账、不验证全套预算分类、不代替联动记账。

registry owner 接入时，从本目录 `index.ts` 取 `supplement: TemplateSupplement` 交给 `server/supplement-catalog.ts`：含两套历史 `templates` 与一套企业 `presets`。`supplement.ts` 仅以 `import type` 引用 `../../preset`，按固定 `f6c851a9d58e389e259efc0722c49c464ab364d8` 的类型约定导出，不复制基表。企业方案由宿主现有 `resolveTemplatePresets` 合成；独立 builder 保留作单独使用及验证。历史模板只可作为历史选择，提交时必须做年份限制。政府参考对象不可加入 templates。注册和向导接入均未在本分支执行，数据定义不代表完整用户功能。

独立测试：在 `app` 执行 `node modules/templates/supplements/infrastructure/run-tests.mjs`。测试只使用临时合成账，读取既有企业JSON作只读合成夹具；覆盖官方46项独立期望表、两种级次、完整父链/方向/备抵、重复及非法编码拒绝，真实SQLite新建/期初/末级制证/辅助拒绝/过账余额，随机整数分维度汇总，以及政府两体系不能互抵。

未完成项：

- core启用年份最小2000，因此1996—1997定义可独立校验，但不能通过现有建账服务创建；测试确认其被拒绝且不留半成品。1998补充版真实建账以2000年合成案例验证，未冒称1998年已能在向导创建。
- 政府完整建账缺少财务/预算体系标识、同一业务双分录联动、完整政府基表和年度收支分类；本包仅核对基建相关部分，未覆盖后续全部解释，不提供2026政府制度完成声明。
- 1998原文使用商务部政府网站刊载的转发通知及完整财政部附件，该页面注明信息来源北大法宝；不是财政部原始影印附件。新增科目的名称、账务处理取附件正文，未采用网站时效标签。未取得财政部原始附件影印版；严格要求发行机关原始文件字节的场景需继续补原件。
- 未实现法定报表、自动待摊投资分配/年初冲转/完工转固/首次执行迁移。实际工程、供应单位、器材、合同、资金来源、资产类别等变动明细须用户按业务建档；现有项目/往来辅助不替代合同号、实物规格及借款备查簿。大型自营、停缓建等表注可增设项及后续专项修订未自动启用。
