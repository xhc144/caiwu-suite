import { BusinessError } from '@caiwu/core';
import {
  TemplateCreationCheckSchema,
  type TemplateCreationCheck,
  type TemplateCreationPolicy,
  type TemplateCreationResult,
} from './shared';

/** 日期是本软件具体版本支持的起始日；较早采用准则的单位须使用相应历史版本。 */
export const templateCreationPolicies: readonly TemplateCreationPolicy[] = [
  {
    templateId: 'resident-medical-insurance-2026',
    effectiveFrom: '2026-01-01',
    source: '财会〔2025〕35号第五项；本版本包含2026新增明细',
  },
  { templateId: 'nonprofit-2026', effectiveFrom: '2026-01-01', source: '财会〔2024〕25号施行通知' },
  {
    templateId: 'farmer-cooperative-2023',
    effectiveFrom: '2023-01-01',
    source: '财会〔2021〕37号施行通知',
  },
  {
    templateId: 'rural-collective-2024',
    effectiveFrom: '2024-01-01',
    source: '财会〔2023〕14号施行通知',
  },
  ...['trade-union-2022', 'grassroots-trade-union-2022'].map((templateId) => ({
    templateId,
    effectiveFrom: '2022-01-01',
    source: '财会〔2021〕7号施行通知',
  })),
  {
    templateId: 'individual-business-1997',
    effectiveFrom: '1997-01-01',
    source: '财会字〔1997〕19号通知',
  },
  {
    templateId: 'school-canteen-anhui-2021',
    effectiveFrom: '2021-01-01',
    source: '皖教秘〔2021〕215号总说明第二、十一项',
    scope: 'anhui-canteen',
  },
  {
    templateId: 'construction-cas-revenue-2017',
    effectiveFrom: '2021-01-01',
    source: '财会〔2017〕22号非上市企业执行日期；本版本仅支持2021年起',
  },
  {
    templateId: 'construction-small-business-2013',
    effectiveFrom: '2013-01-01',
    source: '财会〔2011〕17号施行通知',
  },
  {
    templateId: 'pawn-enterprise-cas-2021',
    effectiveFrom: '2021-01-01',
    source: '财会〔2017〕7号非上市企业执行日期；本版本仅支持2021年起',
  },
  {
    templateId: 'enterprise-infrastructure-cas',
    effectiveFrom: '2021-01-01',
    source: '本行业版本继承已执行新金融工具、新收入和新租赁准则的企业基表',
  },
  {
    templateId: 'real-estate-enterprise',
    effectiveFrom: '2021-01-01',
    source: '本行业版本继承已执行新金融工具、新收入和新租赁准则的企业基表',
  },
  {
    templateId: 'financing-guarantee-cas22-2026',
    effectiveFrom: '2026-01-01',
    source: '本2026版本；财会〔2017〕7号第六条及财政部2021年财务担保实施问答',
    scope: 'guarantee-cas22',
  },
  {
    templateId: 'financing-guarantee-cas25-2026',
    effectiveFrom: '2026-01-01',
    source: '财会〔2020〕20号第四条（六）、财会〔2025〕12号',
    scope: 'guarantee-cas25',
  },
  {
    templateId: 'microloan-enterprise-cas22-2026',
    effectiveFrom: '2026-01-01',
    source: '本2026版本；财会〔2017〕7号；不含此前年度迁移',
  },
  {
    templateId: 'party-dues-jining-port-2021',
    effectiveFrom: '2021-01-01',
    source: '济宁港航地方参考资料，非全国统一党费制度',
    scope: 'reference-only',
  },
];

export function checkTemplateCreation(raw: TemplateCreationCheck): TemplateCreationResult {
  const input = TemplateCreationCheckSchema.parse(raw);
  const policy = templateCreationPolicies.find((p) => p.templateId === input.templateId) ?? null;
  const issues: TemplateCreationResult['issues'] = [];
  if (!policy) return { allowed: true, policy, issues };
  const date = `${input.startYear}-${String(input.startMonth).padStart(2, '0')}-01`;
  if (date < policy.effectiveFrom || (policy.effectiveThrough && date > policy.effectiveThrough))
    issues.push({
      code: 'TEMPLATE_DATE_INVALID',
      field: 'startYear',
      message: `所选制度版本适用日期为${policy.effectiveFrom}起${policy.effectiveThrough ? `至${policy.effectiveThrough}` : ''}，不能用于${date}启用的账套`,
      hint: '请调整启用年月，或选择该年度实际执行的制度版本',
    });
  const facts = input.facts;
  const scopeIssue = (message: string, hint: string) =>
    issues.push({ code: 'TEMPLATE_SCOPE_REQUIRED', field: 'facts', message, hint });
  if (policy.scope === 'reference-only')
    issues.push({
      code: 'TEMPLATE_REFERENCE_ONLY',
      field: 'facts',
      message: '该地方党费科目表仅供参考，不能作为通用制度新建账套',
      hint: '请取得本单位主管部门的适用文件并选择对应制度',
    });
  if (policy.scope === 'anhui-canteen' && facts?.anhuiApprovedNutritionCanteen !== true)
    scopeIssue(
      '本食堂制度仅适用于安徽省经政府批准实施学生营养改善计划的中小学校食堂',
      '请核实地区、学校和营养改善计划批准范围后明确确认',
    );
  if (policy.scope === 'guarantee-cas22' || policy.scope === 'guarantee-cas25') {
    const expected = policy.scope === 'guarantee-cas22' ? 'cas22' : 'cas25';
    if (facts?.guaranteeStandard !== expected || facts.financialGuaranteeContract !== true)
      scopeIssue(
        '请选择与财务担保合同判断一致的核算准则，并确认合同属于财务担保合同',
        '由会计人员判断合同条款；企业名称和启用年份不能代替准则选择',
      );
    if (facts?.designatedAtFairValue !== false)
      scopeIssue(
        '此方案不适用于指定为以公允价值计量且其变动计入当期损益的财务担保合同',
        '请明确确认未作该指定；已作指定的合同应另设适用核算方案',
      );
    if (
      expected === 'cas25' &&
      (facts?.previouslyAssertedInsurance !== true ||
        facts.usedInsuranceAccounting !== true ||
        facts.irrevocableContractElection !== true)
    )
      scopeIssue(
        '保险合同口径须已明确将相关合同视作保险合同并按保险合同准则核算，且按单项合同作出不可撤销选择',
        '请逐项核对并确认既有核算事实及单项合同选择；不满足条件时不能仅按年份选择保险合同口径',
      );
    if (expected === 'cas22' && facts?.irrevocableContractElection === true)
      scopeIssue(
        '已作出不可撤销保险合同准则选择的相关合同不能改用本金融工具方案',
        '请保持该单项合同原选择；两种口径并存的业务须分别设置核算方案',
      );
  }
  return { allowed: issues.length === 0, policy, issues };
}

/** 宿主必须在创建账套/文件之前调用；不能使用建账后钩子回滚来代替。 */
export function assertTemplateCreation(input: TemplateCreationCheck): void {
  const result = checkTemplateCreation(input);
  const first = result.issues[0];
  if (first)
    throw new BusinessError({
      code: first.code,
      message: first.message,
      hint: first.hint,
      details: { issues: result.issues },
    });
}
