import { describe, expect, it } from 'vitest';
import {
  assertTemplateCreation,
  checkTemplateCreation,
  templateCreationPolicies,
} from '../creation-policy';
import type { TemplateFacts } from '../shared';
import { supplements } from '../server/supplement-catalog';
import { registeredTemplates } from './template-fixtures';

const cas22: TemplateFacts = {
  guaranteeStandard: 'cas22',
  financialGuaranteeContract: true,
  designatedAtFairValue: false,
};
const cas25: TemplateFacts = {
  ...cas22,
  guaranteeStandard: 'cas25',
  previouslyAssertedInsurance: true,
  usedInsuranceAccounting: true,
  irrevocableContractElection: true,
};
const input = (templateId: string, facts?: TemplateFacts) => ({
  templateId,
  startYear: 2026,
  startMonth: 1,
  facts,
});

describe('w_xt_kgzb_a2 / a5：制度日期与担保合同选择', () => {
  it('全部已注册模板及行业方案有结构化适用日期，不从说明或编号猜年份', () => {
    for (const template of registeredTemplates()) {
      expect(
        templateCreationPolicies.find((p) => p.templateId === template.id),
        template.id,
      ).toBeDefined();
    }
    for (const preset of supplements.flatMap((s) => s.presets ?? [])) {
      expect(
        templateCreationPolicies.find((p) => p.templateId === preset.id),
        preset.id,
      ).toBeDefined();
    }
    expect(new Set(templateCreationPolicies.map((p) => p.templateId)).size).toBe(
      templateCreationPolicies.length,
    );
  });

  it.each(
    templateCreationPolicies.filter(
      (p) => p.effectiveFrom >= '2001-01-01' && p.scope !== 'reference-only',
    ),
  )('$templateId 起始月接受、前一月拒绝', (policy) => {
    const [year, month] = policy.effectiveFrom.split('-').map(Number) as [number, number, number];
    const facts =
      policy.scope === 'guarantee-cas22'
        ? cas22
        : policy.scope === 'guarantee-cas25'
          ? cas25
          : { anhuiApprovedNutritionCanteen: true };
    expect(
      checkTemplateCreation({
        templateId: policy.templateId,
        startYear: year,
        startMonth: month,
        facts,
      }).allowed,
    ).toBe(true);
    expect(
      checkTemplateCreation({
        templateId: policy.templateId,
        startYear: month === 1 ? year - 1 : year,
        startMonth: month === 1 ? 12 : month - 1,
        facts,
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'TEMPLATE_DATE_INVALID' }));
  });

  it('不按2026年或公司类型自动默认金融工具或保险合同口径', () => {
    for (const id of ['financing-guarantee-cas22-2026', 'financing-guarantee-cas25-2026']) {
      expect(checkTemplateCreation(input(id)).allowed).toBe(false);
      expect(checkTemplateCreation(input(id, {})).allowed).toBe(false);
    }
  });

  it('金融工具口径须明确确认，不能复用保险合同选择或遗漏公允价值事实', () => {
    const id = 'financing-guarantee-cas22-2026';
    expect(checkTemplateCreation(input(id, cas22)).allowed).toBe(true);
    expect(checkTemplateCreation(input(id, cas25)).allowed).toBe(false);
    expect(
      checkTemplateCreation(input(id, { ...cas22, designatedAtFairValue: true })).allowed,
    ).toBe(false);
    expect(
      checkTemplateCreation(input(id, { ...cas22, designatedAtFairValue: undefined })).allowed,
    ).toBe(false);
    expect(
      checkTemplateCreation(input(id, { ...cas22, financialGuaranteeContract: false })).allowed,
    ).toBe(false);
  });

  it.each([
    'previouslyAssertedInsurance',
    'usedInsuranceAccounting',
    'irrevocableContractElection',
  ] as const)('保险合同选择不能省略%s或用false代替', (fact) => {
    const id = 'financing-guarantee-cas25-2026';
    expect(checkTemplateCreation(input(id, cas25)).allowed).toBe(true);
    for (const value of [false, undefined])
      expect(checkTemplateCreation(input(id, { ...cas25, [fact]: value })).allowed).toBe(false);
  });

  it('地方食堂须确认适用范围；济宁党费参考禁止建账', () => {
    expect(checkTemplateCreation(input('school-canteen-anhui-2021')).allowed).toBe(false);
    expect(
      checkTemplateCreation(
        input('school-canteen-anhui-2021', { anhuiApprovedNutritionCanteen: true }),
      ).allowed,
    ).toBe(true);
    expect(() => assertTemplateCreation(input('party-dues-jining-port-2021'))).toThrow('仅供参考');
  });

  it('修改年份后重新校验，错误提供原因和下一步，不保留前次通过状态', () => {
    const selected = input('financing-guarantee-cas25-2026', cas25);
    expect(checkTemplateCreation(selected).allowed).toBe(true);
    expect(() => assertTemplateCreation({ ...selected, startYear: 2025 })).toThrow(
      '不能用于2025-01-01',
    );
    expect(() => assertTemplateCreation({ ...selected, startMonth: 0 })).toThrow();
  });
});
