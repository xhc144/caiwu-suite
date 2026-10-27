import type { CoreServices } from '@caiwu/core/server';
import type { AccountingTemplateInput } from '@caiwu/core';
import type { EnterpriseConfig } from '../templates/enterprise/model';
import { createEnterpriseDraft } from '../templates/enterprise/mapping';

/** 仅自动化测试登记的最小真实科目表；不进入生产注册表。 */
export const statutoryTestTemplate: AccountingTemplateInput = {
  schemaVersion: 1,
  id: 'report-public-test',
  version: '1',
  name: '公共报表接入合成账套',
  regime: 'enterprise',
  devOnly: true,
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'equity', name: '权益', direction: 'credit' },
  ],
  accounts: [
    { code: '1001', name: '库存现金', category: 'asset', cash: true },
    { code: '4001', name: '实收资本', category: 'equity' },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
};
export const statutoryIdentity = {
  definitionId: 'enterprise-2019-appendix2',
  definitionRevision: 1,
  reportKey: 'balance',
};
export const statutoryEvidence = { source: '合成账套已核实政策', version: '1' };
export async function seedStatutoryBook(svc: CoreServices) {
  for (const year of [2023, 2024, 2025]) {
    await svc.periods.ensureYear(year);
    await svc.opening.upsert({
      year,
      accountId: (await svc.accounts.require('1001')).id,
      balance: 100000,
    });
    await svc.opening.upsert({
      year,
      accountId: (await svc.accounts.require('4001')).id,
      balance: -100000,
    });
  }
}
export async function statutoryTestConfiguration(svc: CoreServices): Promise<EnterpriseConfig> {
  const accounts = await svc.accounts.list();
  const c = createEnterpriseDraft(
    202512,
    'annual',
    {
      entityClass: 'unlisted',
      financial: '2020-01-01',
      revenue: '2020-01-01',
      lease: '2020-01-01',
      cas30_2026: null,
      ...statutoryEvidence,
    },
    accounts,
  );
  for (const p of await svc.periods.list())
    for (const basis of ['opening', 'closing'] as const)
      c.cashPolicies.push({
        period: p.period,
        basis,
        accounts: [accounts.find((a) => a.code === '1001')!.id],
        restrictedAccounts: [],
        ...statutoryEvidence,
      });
  c.eps.push(
    {
      from: 202401,
      to: 202412,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...statutoryEvidence,
    },
    {
      from: 202501,
      to: 202512,
      applicable: false,
      preference: '0',
      dilutions: [],
      ...statutoryEvidence,
    },
  );
  return c;
}
