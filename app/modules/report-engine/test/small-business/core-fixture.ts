import { seedVouchers, voucherInputFromSpec, type VoucherSpec } from '@caiwu/testkit';
import type { CoreServices } from '@caiwu/core/server';
import {
  initialConfiguration,
  rowKey,
  entrySignature,
} from '../../templates/small-business/configuration';
import { saveConfiguration } from '../../templates/small-business/statutory.server';
import { smallBusinessApp } from './fixture';
export const detailSeeds = [
  ['540301', 4, 1, 5],
  ['540302', 5, 2, 5],
  ['540303', 6, 3, 5],
  ['540304', 7, 4, 5],
  ['540305', 8, 5, 5],
  ['540306', 9, 6, 5],
  ['540307', 10, 7, 5],
  ['560101', 12, 1101, 6],
  ['560102', 13, 1301, 6],
  ['560201', 15, 1501, 6],
  ['560202', 16, 1601, 6],
  ['560203', 17, 1701, 6],
  ['560301', 19, 1700, 17],
  ['530101', 23, -2301, 2],
  ['571101', 25, 2501, 6],
  ['571102', 26, 2601, 6],
  ['571103', 27, 2701, 6],
  ['571104', 28, 2801, 6],
  ['571105', 29, 2901, 6],
] as const;
export async function completeCoreBook() {
  const app = await smallBusinessApp(1, 2025),
    svc = app.svcFor('report-engine');
  await svc.periods.ensureYear(2026);
  for (const [code, line] of detailSeeds)
    await svc.accounts.create({ code, name: `报表明细${line}` }, [4, 2, 2]);
  await svc.opening.upsert({
    year: 2025,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 100000,
  });
  await svc.opening.upsert({
    year: 2025,
    accountId: (await svc.accounts.require('3001')).id,
    balance: -100000,
  });
  const specs: VoucherSpec[] = [];
  for (const y of [2025, 2026])
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-05`;
      for (const [code, , v, line] of detailSeeds)
        specs.push({
          date,
          status: 'posted',
          summary: `现金项目${line}`,
          lines: [
            { account: code, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 },
            { account: '1001', debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 },
          ],
        });
      for (const [code, v, line] of [
        ['5001', -50001, 1],
        ['5401', 20001, 3],
        ['5111', -2001, 9],
        ['5801', 1001, 5],
      ] as const)
        specs.push({
          date,
          status: 'posted',
          summary: `现金项目${line}`,
          lines: [
            { account: code, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 },
            { account: '1001', debit: v < 0 ? -v : 0, credit: v > 0 ? v : 0 },
          ],
        });
    }
  await seedVouchers(svc, specs);
  let config = initialConfiguration(app.book.id);
  for (const [code, line] of detailSeeds)
    config.details[code] = { line, reason: '按合成凭证明细分类' };
  config.cashScope = ['1001', '100201', '1012'].map((account) => ({
    account,
    from: '2025-01-01',
    to: '2027-12-31',
    available: account !== '1012',
    reason: account === '1012' ? '受限保证金' : '可随时用于支付',
  }));
  const capital = (
    await svc.ledger.balances({
      periodFrom: 202501,
      periodTo: 202501,
      accountCodes: ['3001'],
      rollup: false,
      groupBy: ['partner', 'project', 'department', 'person'],
    })
  )[0]!;
  for (const period of [202412, 202512, ...Array.from({ length: 12 }, (_, m) => 202601 + m)])
    config.facts.push({
      period,
      key: rowKey(capital),
      balance: -100000,
      reason: '注册资本无变动',
      allocations: [{ role: 'capital', amount: -100000 }],
    });
  const entries = await svc.ledger.entries({ periodFrom: 202501, periodTo: 202612, limit: 200000 });
  for (const e of entries.filter((e) => e.accountCode === '1001'))
    config.cashAllocations[String(e.lineId)] = {
      signature: entrySignature(e, entries),
      reason: '凭证实际业务确认',
      parts: [{ line: Number(e.summary.replace('现金项目', '')), amount: e.debit - e.credit }],
    };
  config = await svc.tx((t) => saveConfiguration(t, config, 1));
  return { app, svc, config };
}
export async function closePnl(svc: CoreServices, year: number) {
  const accounts = await svc.accounts.list({ includeDisabled: true }),
    pnl = new Set(accounts.filter((a) => a.categoryId === 'pnl').map((a) => a.code));
  const balances = (
    await svc.ledger.balances({
      periodFrom: year * 100 + 12,
      periodTo: year * 100 + 12,
      rollup: false,
    })
  ).filter((r) => pnl.has(r.accountCode) && r.closing);
  const total = balances.reduce((v, r) => v + r.closing, 0);
  const raw = await voucherInputFromSpec(svc, {
    date: `${year}-12-31`,
    lines: [
      ...balances.map((r) => ({
        account: r.accountCode,
        debit: r.closing < 0 ? -r.closing : 0,
        credit: r.closing > 0 ? r.closing : 0,
      })),
      { account: '3103', debit: total > 0 ? total : 0, credit: total < 0 ? -total : 0 },
    ],
  });
  const v = await svc.vouchers.create({ ...raw, closingKind: 'pnl' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
}
