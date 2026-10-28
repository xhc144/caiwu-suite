import { expect, it } from 'vitest';
import { parseTemplate } from '@caiwu/core';
import {
  checkGovernmentInfrastructurePair,
  governmentInfrastructureReference as reference,
  requireGovernmentInfrastructureBook,
} from '../index';

it('w_xt_kgzb_a2：政府基建保留财务/预算两组，缺少体系能力时阻止伪单账建账', () => {
  expect(reference.kind).toBe('dual-system-reference');
  expect(reference.allowBookCreation).toBe(false);
  expect(
    reference.financialAccounts.filter((a) => a.parentCode === '1613').map((a) => a.name),
  ).toEqual([
    '建筑安装工程投资',
    '设备投资',
    '待摊投资',
    '其他投资',
    '待核销基建支出',
    '基建转出投资',
  ]);
  expect(reference.budgetAccounts.map((a) => [a.code, a.name, a.direction])).toEqual([
    ['6001', '财政拨款预算收入', 'credit'],
    ['7101', '行政支出', 'debit'],
    ['7201', '事业支出', 'debit'],
    ['8001', '资金结存', 'debit'],
    ['800102', '货币资金', 'debit'],
  ]);
  for (const rows of [reference.financialAccounts, reference.budgetAccounts]) {
    const codes = new Set(rows.map((a) => a.code));
    expect(codes.size).toBe(rows.length);
    for (const account of rows) {
      expect([4, 6, 8]).toContain(account.code.length);
      if (account.parentCode) expect(codes.has(account.parentCode)).toBe(true);
      if (account.code.length > 4) expect(account.numberOrigin).toBe('application');
      expect(account.locator).toBeTruthy();
    }
  }
  expect(reference.budgetBreakdowns).toContain('支出功能分类项级');
  expect(reference.budgetBreakdowns).toContain('部门预算支出经济分类款级');
  expect(() => parseTemplate(reference)).toThrow(/模板格式/);
  expect(() => requireGovernmentInfrastructureBook()).toThrow(/独立体系标识/);
});

it('w_xt_kgzb_3：合成工程款实际支付分别平衡，非现金转固无需虚造预算分录', () => {
  expect(() =>
    checkGovernmentInfrastructurePair({
      financial: [
        { code: '16130101', debit: 123_45, credit: 0, project: '单位工程01' },
        { code: '1002', debit: 0, credit: 123_45 },
      ],
      budget: [
        { code: '7201', debit: 123_45, credit: 0, project: '单位工程01' },
        { code: '800102', debit: 0, credit: 123_45 },
      ],
    }),
  ).not.toThrow();
  expect(() =>
    checkGovernmentInfrastructurePair({
      financial: [
        { code: '1601', debit: 123_45, credit: 0 },
        { code: '16130101', debit: 0, credit: 123_45, project: '单位工程01' },
      ],
      budget: [],
    }),
  ).not.toThrow();
});

it('w_xt_kgzb_3：跨体系互抵、串用科目、缺项目、非末级和非整数金额拒绝', () => {
  expect(() =>
    checkGovernmentInfrastructurePair({
      financial: [{ code: '1002', debit: 100, credit: 0 }],
      budget: [{ code: '800102', debit: 0, credit: 100 }],
    }),
  ).toThrow(/财务会计借贷不平衡/);
  for (const row of [
    { code: '16130101', debit: 1, credit: 0 },
    { code: '1613', debit: 1, credit: 0, project: 'P' },
    { code: '7201', debit: 1, credit: 0, project: 'P' },
    { code: '1002', debit: 1.5, credit: 0 },
    { code: '1002', debit: Number.MAX_SAFE_INTEGER + 1, credit: 0 },
    { code: '1002', debit: 1, credit: 1 },
  ])
    expect(() => checkGovernmentInfrastructurePair({ financial: [row], budget: [] })).toThrow();
});
