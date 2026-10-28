import type { CashflowDirection } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { voucherInputFromSpec, type VoucherSpec } from '@caiwu/testkit';

export async function seedFlow(
  svc: CoreServices,
  spec: VoucherSpec & { reversalOfId?: number },
  directions: (CashflowDirection | null)[],
) {
  const input = await voucherInputFromSpec(svc, spec);
  const v = await svc.vouchers.create({
    ...input,
    reversalOfId: spec.reversalOfId,
    lines: input.lines.map((l, i) => ({ ...l, cashflowDirection: directions[i] ?? null })),
  });
  if (spec.status === 'audited' || spec.status === 'posted')
    await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
  if (spec.status === 'posted') await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  return (await svc.vouchers.get(v.id))!;
}
export async function seedCashflowCases(svc: CoreServices) {
  for (const [code, direction] of [
    ['CF01', 'inflow'],
    ['CF02', 'outflow'],
  ] as const) {
    const p = (await svc.dimensions.getByCode('cashflow', code))!;
    await svc.dimensions.update(
      p.id,
      { code, name: p.name, attrs: { cashflowDirection: direction } },
      { expectedRevision: p.revision! },
    );
  }
  const internal = await svc.dimensions.create({
    type: 'cashflow',
    code: 'CF03',
    name: '现金银行内部互转',
    attrs: { cashflowDirection: 'internal' },
  });
  const inflow = (await svc.dimensions.getByCode('cashflow', 'CF01'))!;
  const outflow = (await svc.dimensions.getByCode('cashflow', 'CF02'))!;
  for (const [code, balance] of [
    ['100201', 10000],
    ['1001', 2000],
    ['4001', -12000],
  ] as const)
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require(code)).id,
      balance,
    });
  const incoming = async (
    date: string,
    amount: number,
    status: VoucherSpec['status'] = 'posted',
    reversalOfId?: number,
  ) =>
    seedFlow(
      svc,
      {
        date,
        status,
        reversalOfId,
        lines: [
          { account: '100201', debit: amount, dims: { cashflow: 'CF01' }, summary: '合成销售收款' },
          { account: '6001', credit: amount },
        ],
      },
      ['inflow', null],
    );
  const reversed = await incoming('2026-01-10', 5000);
  await incoming('2026-01-11', 5000);
  await incoming('2026-02-01', 30000);
  await incoming('2026-02-02', -5000, 'posted', reversed.id);
  await seedFlow(
    svc,
    {
      date: '2026-02-03',
      status: 'posted',
      lines: [
        { account: '100201', credit: 2000, dims: { cashflow: 'CF02' }, summary: '合成支付费用' },
        { account: '6603', debit: 2000 },
      ],
    },
    ['outflow', null],
  );
  const transfer = await seedFlow(
    svc,
    {
      date: '2026-02-04',
      status: 'posted',
      lines: [
        { account: '1001', debit: 600, dims: { cashflow: 'CF03' }, summary: '合成银行提现' },
        { account: '100201', credit: 600, dims: { cashflow: 'CF03' }, summary: '合成银行提现' },
      ],
    },
    ['internal', 'internal'],
  );
  const historical = await seedFlow(
    svc,
    {
      date: '2026-02-05',
      status: 'posted',
      lines: [
        { account: '100201', debit: 700, dims: { cashflow: 'CF01' }, summary: '历史流向为空' },
        { account: '6001', credit: 700 },
      ],
    },
    [null, null],
  );
  await seedFlow(
    svc,
    {
      date: '2026-02-06',
      status: 'posted',
      lines: [
        {
          account: '100202',
          debit: 710,
          currency: 'USD',
          fcAmount: 100,
          rate: '7.1',
          dims: { cashflow: 'CF01' },
          summary: '合成美元收款',
        },
        { account: '6001', credit: 710 },
      ],
    },
    ['inflow', null],
  );
  await incoming('2026-02-07', 900, 'pending');
  await incoming('2026-02-08', 400, 'audited');
  await incoming('2026-02-09', 8000, 'draft');
  const voided = await incoming('2026-02-10', 10000, 'pending');
  await svc.vouchers.setVoided(voided.id, true);
  return {
    inflow: inflow.id,
    outflow: outflow.id,
    internal: internal.id,
    transfer: transfer.id,
    historical: historical!.id,
    incoming,
  };
}
