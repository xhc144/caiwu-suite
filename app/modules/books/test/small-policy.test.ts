import { describe, expect, it } from 'vitest';
import { parseTemplate } from '@caiwu/core';
import small from '../templates/small-business.json';
import { WizardSchema } from '../shared';

describe('w_xt_kgzb_a2/a4 正式制度与本位币', () => {
  it('小企业5403依财会〔2016〕22号更名，保留2011一级编码、类别和方向并区分版本', () => {
    const template = parseTemplate(small);
    expect(template.version).toBe('2011.17+2016.22');
    expect(template.accounts).toHaveLength(66);
    expect(template.accounts.find((account) => account.code === '5403')).toMatchObject({
      name: '税金及附加',
      category: 'pnl',
      direction: 'debit',
      source: expect.stringContaining('财会〔2016〕22号第二（二）3'),
    });
    expect(template.sources).toContainEqual(
      expect.objectContaining({
        file: 'https://www.mof.gov.cn/gp/xxgkml/hjs/201612/t20161214_2512803.htm',
      }),
    );
  });

  it('w_xt_kgzb_1 有效输入必须明确人民币；缺本位币、空值或非人民币拒绝', () => {
    const valid = {
      name: '合成账套',
      orgName: '合成单位',
      templateId: small.id,
      product: 'qingsong',
      codeScheme: '4-2-2',
      baseCurrency: 'CNY',
      adminCode: 'admin',
      adminName: '管理员',
      startYear: 2026,
      startMonth: 1,
    };
    expect(WizardSchema.safeParse(valid).success).toBe(true);
    for (const baseCurrency of [undefined, '', 'USD'])
      expect(WizardSchema.safeParse({ ...valid, baseCurrency }).success).toBe(false);
  });
});
