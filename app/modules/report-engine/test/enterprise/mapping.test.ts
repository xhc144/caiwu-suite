import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import {
  balanceSheetSlots,
  buildBalanceSheetSlice,
  type BalanceBindings,
} from '../../templates/enterprise';
import { balanceBindings, setupEnterpriseFixture } from './fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});
async function result(bindings: BalanceBindings) {
  const api = app.call(reportServer);
  const report = await api.importTemplate(
    buildBalanceSheetSlice(bindings, await app.svc.accounts.list()),
  );
  const generated = await api.generate({
    id: report.id,
    expectedRevision: report.revision,
    period: 202601,
    requestId: randomUUID(),
  });
  if (generated.kind !== 'generated') throw new Error('意外的未过账确认');
  return generated.snapshot;
}
const na = {
  state: 'notApplicable',
  reason: '该独立测试账套没有此项业务，已明确声明不适用',
} as const;

it('P2 固定资产仅原值127000不能自动当净额；旧roots和漏折旧/减值/清理角色必须拒绝', async () => {
  await setupEnterpriseFixture(app.svc);
  const catalog = await app.svc.accounts.list();
  const gross = await app.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202601,
    accountCodes: ['1601'],
    rollup: false,
  });
  expect(gross[0]!.closing).toBe(127000);
  expect(() => buildBalanceSheetSlice({ fixedAssets: ['1601'] } as never, catalog)).toThrow();
  expect(() =>
    buildBalanceSheetSlice(
      { fixedAssets: { gross: { state: 'mapped', accounts: ['1601'] } } } as never,
      catalog,
    ),
  ).toThrow(/缺少组成角色/);
  const s = await result({ fixedAssets: balanceBindings.fixedAssets });
  expect(s.cells.find((c) => c.address === balanceSheetSlots.fixedAssets!.current)).toMatchObject({
    unit: 'cents',
    value: '95000',
  });
  expect(s.cells.some((c) => c.value.includes('固定资产 / 累计折旧：取真实科目 1602'))).toBe(true);
});

it('P2 零余额声明仍读取真实余额；错误零声明不能把应扣25000折旧抹掉', async () => {
  await setupEnterpriseFixture(app.svc);
  const s = await result({
    fixedAssets: {
      ...balanceBindings.fixedAssets,
      accumulatedDepreciation: {
        state: 'zero',
        accounts: ['1602'],
        reason: '测试错误的零余额声明，不得跳过真实取数',
      },
    },
  });
  expect(s.cells.find((c) => c.address === balanceSheetSlots.fixedAssets!.current)!.value).toBe(
    '95000',
  );
  expect(s.checks.find((c) => c.name.includes('累计折旧零余额声明'))).toMatchObject({
    status: 'fail',
    difference: '-25000',
  });
});

it('P2 明确零余额与不适用声明进入报表，实际零账户校验通过，缺声明仍拒绝', async () => {
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('1601')).id,
    balance: 10000,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('4001')).id,
    balance: -10000,
  });
  const s = await result({
    fixedAssets: {
      gross: { state: 'mapped', accounts: ['1601'] },
      accumulatedDepreciation: {
        state: 'zero',
        accounts: ['1602'],
        reason: '该测试期末没有折旧余额，仍须读取1602校验',
      },
      impairment: na,
      disposalClearing: na,
    },
  });
  expect(s.cells.find((c) => c.address === balanceSheetSlots.fixedAssets!.current)!.value).toBe(
    '10000',
  );
  expect(s.checks.find((c) => c.name.includes('累计折旧零余额声明'))!.status).toBe('pass');
  expect(s.cells.some((c) => c.value.includes('固定资产 / 减值准备：已声明不适用'))).toBe(true);
  expect(() =>
    buildBalanceSheetSlice(
      {
        fixedAssets: {
          gross: { state: 'mapped', accounts: ['1601'] },
          accumulatedDepreciation: { state: 'notApplicable', reason: '' },
          impairment: na,
          disposalClearing: na,
        },
      },
      [],
    ),
  ).toThrow();
});

it('P2 全部角色不适用保持文本；未知角色与不存在账户不启用数值行', async () => {
  const s = await result({
    fixedAssets: { gross: na, accumulatedDepreciation: na, impairment: na, disposalClearing: na },
  });
  expect(s.cells.find((c) => c.address === balanceSheetSlots.fixedAssets!.current)).toMatchObject({
    unit: 'text',
    value: expect.stringContaining('不是零金额'),
  });
  const catalog = await app.svc.accounts.list();
  expect(() =>
    buildBalanceSheetSlice(
      {
        fixedAssets: {
          gross: na,
          accumulatedDepreciation: na,
          impairment: na,
          disposalClearing: na,
          typo: na,
        },
      } as never,
      catalog,
    ),
  ).toThrow(/未知组成角色/);
  expect(() =>
    buildBalanceSheetSlice(
      { goodwill: { gross: { state: 'mapped', accounts: ['9999'] }, impairment: na } },
      catalog,
    ),
  ).toThrow(/不存在/);
});
