import { afterEach, beforeEach, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { sql } from '@caiwu/db';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { qtyFromE6, type BusinessError } from '@caiwu/core';
import openingServer from '../server';
import { headers } from '../server/excel';
import { accountTree, exactSum, rowVersion, strictMoney, type SavedRow } from '../shared';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [openingServer] });
});
afterEach(async () => await app.close());
const api = () => app.call(openingServer);
async function workbook(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('期初');
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
const cells = (code = '1001', amount = '1.01'): unknown[] => [
  '2026',
  code,
  '',
  '',
  '',
  '',
  '',
  '借',
  amount,
  amount,
  '0.00',
  '0',
  '0.00',
  '0.00',
];
async function code(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(e).not.toBeNull();
  return (e as { cause: BusinessError }).cause.data.code;
}
it('w_xt_ye：Excel逐行预览坏编码、重复键、非末级、错误维度币种、金额格式；非法后行整批不变', async () => {
  const badAccount = cells('9999'),
    parent = cells('1002'),
    badDim = cells('5001'),
    badCurrency = cells('1001'),
    amount = cells('4001', '1.001');
  badDim[2] = 'BAD';
  badCurrency[6] = 'USD';
  const file = await workbook([cells(), cells(), badAccount, parent, badDim, badCurrency, amount]);
  const preview = await api().preview({ year: 2026, file, mode: 'add' });
  expect(preview.valid).toBe(false);
  expect(preview.preview).toHaveLength(7);
  expect(preview.preview[0]).toMatchObject({ row: 2, status: '新增', error: null });
  expect(preview.preview.slice(1).every((r) => r.error)).toBe(true);
  expect(
    await code(
      api().import({ year: 2026, file, mode: 'add', expected: preview.expected, confirmed: true }),
    ),
  ).toBe('OPENING_IMPORT_INVALID');
  expect(await app.svc.opening.list(2026)).toEqual([]);
});
it('w_xt_ye：Excel新增遇重复报错，明确覆盖不叠加也不删除未包含行；取消不写入', async () => {
  const file = await workbook([cells()]);
  const preview = await api().preview({ year: 2026, file, mode: 'add' });
  expect(
    await code(
      api().import({ year: 2026, file, mode: 'add', expected: preview.expected, confirmed: false }),
    ),
  ).toBe('OPENING_CONFIRM_IMPORT');
  expect(await app.svc.opening.list(2026)).toEqual([]);
  await api().import({
    year: 2026,
    file,
    mode: 'add',
    expected: preview.expected,
    confirmed: true,
  });
  expect((await api().preview({ year: 2026, file, mode: 'add' })).valid).toBe(false);
  const equity = (await app.svc.accounts.require('4001')).id;
  await api().save({
    year: 2026,
    changes: [{ data: { year: 2026, accountId: equity, balance: -101 } }],
  });
  for (let i = 0; i < 2; i++) {
    const p = await api().preview({ year: 2026, file, mode: 'overwrite' });
    await api().import({
      year: 2026,
      file,
      mode: 'overwrite',
      expected: p.expected,
      confirmed: true,
    });
  }
  const saved = await app.svc.opening.list(2026);
  expect(saved).toHaveLength(2);
  expect(saved.map((r) => r.balance)).toEqual([101, -101]);
});
it('w_xt_ye：Excel真实后行写入故障回滚已写前行及日志', async () => {
  const file = await workbook([cells(), cells('4001', '2.02')]);
  const preview = await api().preview({ year: 2026, file, mode: 'add' });
  const a = await app.svc.accounts.require('4001');
  await sql
    .raw(
      `CREATE TRIGGER opening_test_import_fail BEFORE INSERT ON opening_balance WHEN NEW.account_id = ${a.id} BEGIN SELECT RAISE(ABORT, '导入故障'); END`,
    )
    .execute(app.svc.db);
  await expect(
    api().import({ year: 2026, file, mode: 'add', expected: preview.expected, confirmed: true }),
  ).rejects.toThrow('导入故障');
  expect(await app.svc.opening.list(2026)).toEqual([]);
  expect((await app.svc.log.list()).filter((l) => l.module === 'opening')).toEqual([]);
});
it('w_xt_ye：Excel确认时重新检查过账/锁定以及预览版本，不能绕过保护', async () => {
  const file = await workbook([cells()]);
  const p = await api().preview({ year: 2026, file, mode: 'add' });
  const [v] = await seedVouchers(app.svc, [
    {
      date: '2026-02-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 1 },
        { account: '4001', credit: 1 },
      ],
    },
  ]);
  expect(
    await code(
      api().import({ year: 2026, file, mode: 'add', expected: p.expected, confirmed: true }),
    ),
  ).toBe('OPENING_POSTED');
  expect(await app.svc.opening.list(2026)).toEqual([]);
  await app.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
  const a = (await app.svc.accounts.require('4001')).id;
  await api().save({ year: 2026, changes: [{ data: { year: 2026, accountId: a, balance: 0 } }] });
  expect(
    await code(
      api().import({ year: 2026, file, mode: 'add', expected: p.expected, confirmed: true }),
    ),
  ).toBe('OPENING_STALE');
  await api().setLock({ year: 2026, locked: true });
  const latest = await api().preview({ year: 2026, file, mode: 'add' });
  expect(
    await code(
      api().import({ year: 2026, file, mode: 'add', expected: latest.expected, confirmed: true }),
    ),
  ).toBe('OPENING_LOCKED');
});
it('w_xt_ye：Excel拒绝公式、错误表头、空模板以及辅助汇总双计', async () => {
  const formula = cells();
  formula[8] = { formula: '1+2', result: 3 };
  const p = await api().preview({ year: 2026, file: await workbook([formula]), mode: 'add' });
  expect(p.valid).toBe(false);
  expect(p.preview[0]!.error).toMatch(/公式/);
  expect(await code(api().preview({ year: 2026, file: await workbook([]), mode: 'add' }))).toBe(
    'OPENING_EXCEL_EMPTY',
  );
  const optional = cells('6601'),
    detail = cells('6601');
  detail[4] = '01';
  expect(
    (await api().preview({ year: 2026, file: await workbook([optional, detail]), mode: 'add' }))
      .valid,
  ).toBe(false);
});
it('w_xt_ye：fast-check父级汇总只由末级组成，任意分金额保持精确', async () => {
  const accounts = await app.svc.accounts.list(),
    leaves = accounts.filter((a) => a.isLeaf);
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: -100000000, max: 100000000 }), {
        minLength: leaves.length,
        maxLength: leaves.length,
      }),
      (values) => {
        const rows: SavedRow[] = leaves.map((a, i) => ({
          id: i + 1,
          year: 2026,
          accountId: a.id,
          dimensions: {},
          currency: null,
          balance: values[i]!,
          fcBalance: 0,
          quantity: '0',
          ytdDebit: 0,
          ytdCredit: 0,
        }));
        const tree = accountTree(accounts, rows);
        expect(exactSum(tree.map((r) => r.balance))).toBe(exactSum(values));
        const walk = (nodes: typeof tree) => {
          for (const n of nodes) {
            if (n.children) {
              expect(n.balance).toBe(exactSum(n.children.map((c) => c.balance)));
              walk(n.children);
            }
          }
        };
        walk(tree);
        for (const v of values) {
          const sign = v < 0 ? '-' : '';
          const text = `${sign}${Math.trunc(Math.abs(v) / 100)}.${String(Math.abs(v) % 100).padStart(2, '0')}`;
          expect(strictMoney(text)).toBe(v);
        }
      },
    ),
    { numRuns: 80 },
  );
});
it('w_xt_ye：fast-check真实数据库Excel往返可逆、重复覆盖不双计，保留辅助/外币/数量及显式零', async () => {
  const cash = (await app.svc.accounts.require('1001')).id,
    usd = (await app.svc.accounts.require('100202')).id,
    qty = (await app.svc.accounts.require('1403')).id,
    project = (await app.svc.accounts.require('5001')).id,
    xm = (await app.svc.dimensions.getByCode('project', 'XM01'))!.id;
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: -100000000, max: 100000000 }),
      fc.integer({ min: -9999999, max: 9999999 }),
      async (balance, quantityE6) => {
        const rows = await app.svc.opening.list(2026);
        const inputs = [
          { year: 2026, accountId: cash, balance: 0 },
          { year: 2026, accountId: usd, currency: 'USD', balance, fcBalance: 101 },
          { year: 2026, accountId: qty, balance: 1, quantity: qtyFromE6(quantityE6) },
          { year: 2026, accountId: project, balance: 2, dimensions: { project: xm } },
        ];
        await api().save({
          year: 2026,
          changes: inputs.map((data) => {
            const old = rows.find((r) => r.accountId === data.accountId);
            return { data, ...(old ? { id: old.id, expected: rowVersion(old) } : {}) };
          }),
        });
        const before = await app.svc.opening.list(2026),
          output = await api().export({ year: 2026 });
        for (let i = 0; i < 2; i++) {
          const p = await api().preview({ year: 2026, file: output.file, mode: 'overwrite' });
          expect(p.valid).toBe(true);
          await api().import({
            year: 2026,
            file: output.file,
            mode: 'overwrite',
            expected: p.expected,
            confirmed: true,
          });
        }
        expect(await app.svc.opening.list(2026)).toEqual(before);
        const ledger = await app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          rollup: true,
        });
        const parent = ledger.find((r) => r.accountCode === '1002');
        expect(parent?.opening ?? 0).toBe(balance);
      },
    ),
    { numRuns: 12 },
  );
});
