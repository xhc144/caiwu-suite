import { expect, it } from 'vitest';
import { AccountingTemplateSchema } from '@caiwu/core';
import { buildEnterpriseInfrastructureTemplate, supplement } from '../index';
import { readEnterpriseBase } from './base';

it('w_xt_kgzb_a2：统一supplement仅含两套历史定义与一个具名企业preset', () => {
  expect(supplement.templates).toHaveLength(2);
  expect(supplement.presets).toHaveLength(1);
  const preset = supplement.presets![0]!;
  expect(preset).toMatchObject({
    id: 'enterprise-infrastructure-cas',
    version: '2006.18+2026.2+infrastructure.1.0.0',
    baseTemplateId: 'books-enterprise-cas-2006',
    baseTemplateVersion: '2006.18+2026.2',
    codeScheme: '4-2-2',
  });
  expect(preset.accountOverrides).toEqual([
    expect.objectContaining({
      code: '1604',
      source: expect.any(String),
      dimensions: [{ type: 'project', required: true }],
    }),
  ]);
  const built = buildEnterpriseInfrastructureTemplate(readEnterpriseBase());
  expect(
    preset.additionalAccounts!.map((a) =>
      AccountingTemplateSchema.shape.accounts.element.strict().parse(a),
    ),
  ).toEqual(built.accounts.filter((a) => a.code.startsWith('1604') && a.code.length > 4));
  expect(
    supplement.templates!.every((t) => AccountingTemplateSchema.parse(t).status === 'deprecated'),
  ).toBe(true);
});
