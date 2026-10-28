import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestBook, voucherInputFromSpec, type LineSpec, type TestBook } from '@caiwu/testkit';
import type { Voucher } from '@caiwu/core';
import { chart } from './chart';
import { annual, income, expenses, seedFullYear, confirmFixture } from './fixture';
import type { Configuration } from '../../templates/nonprofit/model';
import { nonprofitClosingKind } from '../../templates/nonprofit/closing-source';
import { readNonprofitSources, sourceFingerprint } from '../../templates/nonprofit/sources.server';
import { generateNonprofit } from '../../templates/nonprofit/statutory.server';

let book: TestBook, c: Configuration;
beforeEach(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
});
afterEach(async () => book?.close());
const amounts = (v: Awaited<ReturnType<typeof generateNonprofit>>) =>
  Object.fromEntries(v.statement.rows.filter((r) => !r.section).map((r) => [r.id, r.values]));

async function post(
  lines: LineSpec[],
  opts: { module?: string | null; type?: string; id?: string; marker?: string } = {},
) {
  const module = opts.module === undefined ? 'period-close' : opts.module;
  const svc = module ? book.forModule(module) : book.svc;
  const input = await voucherInputFromSpec(svc, { date: '2026-12-31', lines });
  const v = await svc.vouchers.create({
    ...input,
    closingKind: opts.marker ?? 'period-close:NF_CLOSE',
    ...(module ? { source: { type: opts.type ?? 'closing', id: opts.id ?? '202612:1' } } : {}),
  });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  return (await svc.vouchers.get(v.id))!;
}
const pnlLines = (factor = 1, unrestricted = 12240, restricted = 8160): LineSpec[] => [
  ...income.map(([account, n]) => ({ account, debit: n * 12 * factor })),
  ...expenses.map(([account, n]) => ({ account, credit: n * 12 * factor })),
  { account: '3101', credit: unrestricted * factor },
  { account: '3102', credit: restricted * factor },
];

it('w_bb_proc 自定义真实损益结转：401/402逐行不变，403不受影响，来源页面无需重认结转分录', async () => {
  const before = await Promise.all(
    (['401', '402', '403'] as const).map((code) =>
      generateNonprofit(book.svc, { ...annual, code }, c),
    ),
  );
  const v = await post(pnlLines());
  const s = await readNonprofitSources(book.svc, annual);
  const closing = s.entries.filter((e) => e.voucherId === v.id);
  expect(closing).toHaveLength(17);
  expect(closing.every((e) => e.closingKind === 'pnl')).toBe(true);
  for (const e of closing)
    expect(e.closingSource).toEqual({
      originalKind: 'period-close:NF_CLOSE',
      source: { module: 'period-close', type: 'closing', id: '202612:1' },
    });
  expect(
    s.entries.filter((e) => e.closingKind !== 'pnl' && e.accountCode.startsWith('4')),
  ).toHaveLength(96);
  for (const [i, code] of (['401', '402', '403'] as const).entries()) {
    const after = await generateNonprofit(book.svc, { ...annual, code }, c);
    expect(amounts(after)).toEqual(amounts(before[i]!));
    expect(after.statement.checks.every((x) => x.difference === 0)).toBe(true);
  }
  const changed = structuredClone(s);
  changed.entries.find((e) => e.voucherId === v.id)!.closingSource!.source!.id = '202612:2';
  expect(sourceFingerprint(changed, c)).not.toBe(sourceFingerprint(s, c));
  changed.entries.find((e) => e.voucherId === v.id)!.closingSource!.source!.id = '202612:1';
  changed.entries.find((e) => e.voucherId === v.id)!.closingSource!.originalKind =
    'period-close:OTHER';
  expect(sourceFingerprint(changed, c)).not.toBe(sourceFingerprint(s, c));
});

it('w_bb_proc 自定义50%损益结转仍有余额，不能因兼容标记而正式出表', async () => {
  await post(pnlLines(0.5));
  for (const code of ['401', '402'] as const)
    await expect(generateNonprofit(book.svc, { ...annual, code }, c)).rejects.toThrow(/仍有余额/);
});

it('w_bb_proc 自定义损益结转总额结清但错转限定性类别，401/402均拒绝', async () => {
  await post(pnlLines(1, 12241, 8159));
  for (const code of ['401', '402'] as const)
    await expect(generateNonprofit(book.svc, { ...annual, code }, c)).rejects.toThrow(
      /逐笔资源分类不一致/,
    );
});

it.each(['1002', '220201'])('w_bb_proc 自定义费用转现金或负债%s是业务，不忽略', async (account) => {
  const v = await post([
    { account: '5301', debit: 100 },
    { account, credit: 100 },
  ]);
  const s = await readNonprofitSources(book.svc, annual);
  expect(
    s.entries
      .filter((e) => e.voucherId === v.id)
      .every((e) => e.closingKind === 'period-close:NF_CLOSE'),
  ).toBe(true);
  await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
    /逐笔确认不完整/,
  );
});

it('w_bb_proc 自定义损益科目互转是业务，不按净资产结转排除', async () => {
  const v = await post([
    { account: '4101', debit: 100 },
    { account: '4301', credit: 100 },
  ]);
  const s = await readNonprofitSources(book.svc, annual);
  expect(
    s.entries
      .filter((e) => e.voucherId === v.id)
      .every((e) => e.closingKind === 'period-close:NF_CLOSE'),
  ).toBe(true);
  await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
    /逐笔确认不完整/,
  );
});

it('w_bb_proc 自定义净资产互转必须确认真实解除或设限事件', async () => {
  const v = await post([
    { account: '3101', debit: 100 },
    { account: '3102', credit: 100 },
  ]);
  const s = await readNonprofitSources(book.svc, annual);
  expect(
    s.entries
      .filter((e) => e.voucherId === v.id)
      .every((e) => e.closingKind === 'period-close:NF_CLOSE'),
  ).toBe(true);
  await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
    /尚未确认互转/,
  );
});

it.each([
  { module: null },
  { module: 'payroll' },
  { type: 'other' },
  { id: '202611:1' },
  { id: '202612:0' },
  { id: '202612:1:other' },
  { marker: 'period-close:NF.CLOSE' },
])('w_bb_proc 冒用前缀、来源或规则身份%j不能按损益结转忽略', async (opts) => {
  const v = await post(pnlLines(), opts);
  const s = await readNonprofitSources(book.svc, annual);
  expect(
    s.entries.filter((e) => e.voucherId === v.id).every((e) => e.closingKind === v.closingKind),
  ).toBe(true);
  await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
    /逐笔确认不完整/,
  );
});

it('w_bb_proc 借贷不平或名为3101但实际属于资产类别的凭证结构不被兼容', async () => {
  const v = await post(pnlLines());
  const accounts = await book.svc.accounts.list(),
    categories = await book.svc.accounts.categories();
  const unbalanced: Voucher = structuredClone(v);
  unbalanced.lines[0]!.debit -= 1;
  expect(nonprofitClosingKind(unbalanced, accounts, categories)).toBe(v.closingKind);
  const wrongAccounts = accounts.map((a) =>
    a.code === '3101' ? { ...a, categoryId: 'asset' } : a,
  );
  expect(nonprofitClosingKind(v, wrongAccounts, categories)).toBe(v.closingKind);
});
