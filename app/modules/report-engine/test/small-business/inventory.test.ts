import { afterEach, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import { completeCoreBook } from './core-fixture';
import {
  prepareSmallBusiness,
  saveConfiguration,
  assertSmallBusinessOutput,
  smallBusinessConfigurationData,
} from '../../templates/small-business/statutory.server';
import { rowKey } from '../../templates/small-business/configuration';
let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});
it('w_bb_proc 动态母科目、新增末级、停用历史科目、非标准存货和有符号差异完整覆盖', async () => {
  const built = await completeCoreBook();
  app = built.app;
  const { svc } = built;
  let config = built.config;
  await svc.accounts.create({ code: '140301', name: '原料一' }, [4, 2, 2]);
  await seedVouchers(svc, [
    {
      date: '2026-12-10',
      status: 'posted',
      lines: [
        { account: '140301', debit: 100 },
        { account: '3001', credit: 100 },
      ],
    },
  ]);
  const confirm = async (capital: number) => {
    for (const f of config.facts.filter((f) => f.period === 202612 && f.key.startsWith('3001|'))) {
      f.balance = -capital;
      f.allocations = [{ role: 'capital', amount: -capital }];
    }
    config = await svc.tx((t) => saveConfiguration(t, config, config.revision));
  };
  await confirm(100100);
  let p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[0].rows[8]!.amounts[0].value).toBe(100);
  await svc.accounts.create({ code: '140302', name: '原料二' }, [4, 2, 2]);
  await seedVouchers(svc, [
    {
      date: '2026-12-11',
      status: 'posted',
      lines: [
        { account: '140302', debit: 77 },
        { account: '3001', credit: 77 },
      ],
    },
  ]);
  await confirm(100177);
  await svc.db.updateTable('account').set({ disabled: 1 }).where('code', '=', '140301').execute();
  p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[0].rows[8]!.amounts[0].value).toBe(177);
  expect(p.statements[0].rows[9]!.amounts[0].value).toBe(177);
  await svc.accounts.create({ code: '1499', name: '其他实际存货', categoryId: 'asset' }, [4, 2, 2]);
  await seedVouchers(svc, [
    {
      date: '2026-12-12',
      status: 'posted',
      lines: [
        { account: '1499', debit: 5 },
        { account: '3001', credit: 5 },
      ],
    },
    {
      date: '2026-12-12',
      status: 'posted',
      lines: [
        { account: '1404', credit: 25 },
        { account: '1407', credit: 10 },
        { account: '3001', debit: 35 },
      ],
    },
  ]);
  await expect(
    svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' })),
  ).rejects.toThrow(/1499.*未指定/);
  config.mappings['1499'] = { role: 'otherInventory', reason: '真实新增的其他存货母科目' };
  const variance = (
    await svc.ledger.balances({ periodFrom: 202612, periodTo: 202612, rollup: false })
  ).find((r) => r.accountCode === '1404')!;
  config.facts.push({
    period: 202612,
    key: rowKey(variance),
    balance: -25,
    reason: '期末材料成本差异对应原材料',
    allocations: [{ role: 'raw', amount: -25 }],
  });
  await confirm(100147);
  p = await svc.tx((t) => prepareSmallBusiness(t, { period: 202612, mode: 'annual' }));
  assertSmallBusinessOutput(p);
  expect(p.statements[0].rows[8]!.amounts[0].value).toBe(147);
  expect(p.statements[0].rows[9]!.amounts[0].value).toBe(152);
  expect(p.statements[0].rows[11]!.amounts[0].value).toBe(-10);
  expect(p.statements[0].rows[50]!.amounts[0].value).toBe(260712);
  const form = await smallBusinessConfigurationData(svc, 202612);
  expect(
    form.analysisRows.find((row) => row.period === 202612 && row.row.accountCode === '1404'),
  ).toMatchObject({ balance: -25, destinations: ['raw', 'turnover', 'otherInventory'] });
}, 20000);
