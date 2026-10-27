import type { AccountingTemplateInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { Balance401Mapping } from '../../templates/nonprofit/balance-sheet';
import { fixtureChart, nonprofitTestServer } from './fixture';

/** 仅增补真实空科目以验证无余额项目，不用常数0代替未实现取数。 */
const extra: AccountingTemplateInput['accounts'] = [
  { code: '1132', name: '预付账款', category: 'asset' },
  { code: '1201', name: '待摊费用', category: 'asset' },
  { code: '1291', name: '其他流动资产', category: 'asset' },
  { code: '150103', name: '未来非流动债权批次', category: 'asset' },
  { code: '150203', name: '未来非流动债权减值批次', category: 'asset', direction: 'credit' },
  { code: '1503', name: '长期股权投资', category: 'asset' },
  { code: '1504', name: '长期股权投资减值准备', category: 'asset', direction: 'credit' },
  { code: '1505', name: '其他长期投资', category: 'asset' },
  { code: '1506', name: '其他长期投资减值准备', category: 'asset', direction: 'credit' },
  { code: '1611', name: '在建工程', category: 'asset' },
  { code: '1621', name: '固定资产清理', category: 'asset' },
  { code: '1811', name: '长期待摊费用', category: 'asset' },
  { code: '2201', name: '应付款项', category: 'liability' },
  { code: '2202', name: '应付职工薪酬', category: 'liability' },
  { code: '2203', name: '应交税费', category: 'liability' },
  { code: '2204', name: '预收账款', category: 'liability' },
  { code: '2205', name: '预提费用', category: 'liability' },
  { code: '2291', name: '其他流动负债', category: 'liability' },
  { code: '230103', name: '未来非流动借款批次', category: 'liability' },
  { code: '2302', name: '长期应付款', category: 'liability' },
  { code: '2303', name: '预计负债', category: 'liability' },
  { code: '2391', name: '其他长期负债', category: 'liability' },
];
export const balanceFixtureChart = {
  ...fixtureChart,
  accounts: [...fixtureChart.accounts, ...extra],
};
export const balanceTestServer = { ...nonprofitTestServer, templates: [balanceFixtureChart] };

export function balanceFixtureMapping(period = 202602): Balance401Mapping {
  const groups = {
    cash: ['1001', '100201', '100202'],
    agencyCash: ['100202'],
    shortInvestment: ['1101'],
    shortImpairment: ['1102'],
    receivables: ['1122'],
    badDebt: ['1131'],
    prepayments: ['1132'],
    inventory: ['1401'],
    inventoryImpairment: ['1402'],
    deferred: ['1201'],
    currentInvestment: ['150101'],
    currentInvestmentImpairment: ['150201'],
    otherCurrentAssets: ['1291'],
    equityInvestment: ['1503'],
    equityInvestmentImpairment: ['1504'],
    debtInvestment: ['150102', '150103'],
    debtInvestmentImpairment: ['150202', '150203'],
    otherInvestment: ['1505'],
    otherInvestmentImpairment: ['1506'],
    fixedCost: ['1601'],
    depreciation: ['1602'],
    fixedImpairment: ['1603'],
    construction: ['1611'],
    disposal: ['1621'],
    culturalResources: ['1701'],
    intangibleCost: ['1801'],
    amortization: ['1802'],
    intangibleImpairment: ['1803'],
    longDeferred: ['1811'],
    agencyAsset: ['1901'],
    shortBorrowing: ['2001'],
    payables: ['2201'],
    employees: ['2202'],
    taxes: ['2203'],
    advances: ['2204'],
    accruals: ['2205'],
    currentDebt: ['230101'],
    otherCurrentLiabilities: ['2291'],
    longBorrowing: ['230102', '230103'],
    longPayables: ['2302'],
    provisions: ['2303'],
    otherLongLiabilities: ['2391'],
    agencyLiability: ['2101'],
    unrestricted: ['3101'],
    restricted: ['3102'],
  };
  return {
    period,
    groups: Object.fromEntries(
      Object.entries(groups).map(([id, accounts]) => [
        id,
        {
          accounts,
          basis:
            id === 'currentInvestment' ||
            id === 'debtInvestment' ||
            id === 'currentDebt' ||
            id === 'longBorrowing'
              ? `虚构合同到期清单（基准${period}），逐末级科目识别1年内外，非按项目猜测`
              : `虚构${period}账套科目及原始单据核对：${id}`,
        },
      ]),
    ) as Balance401Mapping['groups'],
  };
}

export const balanceOpeningGolden = {
  '1001': 10_000,
  '100201': 50_000,
  '100202': 7_000,
  '1101': 20_000,
  '1102': -2_000,
  '1122': 30_000,
  '1131': -3_000,
  '1401': 15_000,
  '1402': -1_000,
  '150101': 12_000,
  '150102': 28_000,
  '150201': -1_000,
  '150202': -2_000,
  '1601': 80_000,
  '1602': -16_000,
  '1603': -4_000,
  '1701': 9_000,
  '1801': 20_000,
  '1802': -5_000,
  '1803': -1_000,
  '1901': 3_000,
  '2001': -25_000,
  '2101': -10_000,
  '230101': -10_000,
  '230102': -20_000,
  '3101': -144_000,
  '3102': -40_000,
};
export async function seedBalance401Book(svc: CoreServices) {
  for (const [code, balance] of Object.entries(balanceOpeningGolden))
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require(code)).id,
      balance,
    });
}

/** 逐项目独立手算；全为整数分，空余额项目为真实科目取数结果。 */
export const balance401ClosingGolden = {
  C6: '60000',
  C7: '18000',
  C8: '27000',
  C9: '0',
  C10: '14000',
  C11: '0',
  C12: '11000',
  C13: '0',
  C14: '130000',
  C17: '0',
  C18: '26000',
  C19: '0',
  C20: '26000',
  C22: '80000',
  C23: '16000',
  C24: '60000',
  C25: '0',
  C26: '0',
  C27: '60000',
  C28: '9000',
  C30: '20000',
  C31: '5000',
  C32: '14000',
  C33: '0',
  C34: '109000',
  C36: '10000',
  C37: '249000',
  F6: '25000',
  F7: '0',
  F8: '0',
  F9: '0',
  F10: '0',
  F11: '0',
  F12: '10000',
  F13: '0',
  F14: '35000',
  F16: '20000',
  F17: '0',
  F18: '0',
  F19: '0',
  F20: '20000',
  F22: '10000',
  F23: '65000',
  F25: '144000',
  F26: '40000',
  F27: '184000',
  F28: '249000',
};
