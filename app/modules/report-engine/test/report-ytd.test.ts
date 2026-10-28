import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp, type VoucherSpec } from '@caiwu/testkit';
import reportServer from '../server';
import { balanceFormula, emptyTemplate, type BalanceFunction } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [reportServer] });
});
afterEach(async () => {
  await app.close();
});

async function report(unit: 'foreignCents' | 'quantity', metric: BalanceFunction['metric']) {
  const template = emptyTemplate({ code: '101', name: '外币数量累计合成报表', rows: 2, cols: 1 });
  template.cells = [
    {
      address: 'A1',
      kind: 'formula',
      source: balanceFormula({
        account: unit === 'foreignCents' ? '100202' : '1403',
        unit,
        metric,
        currency: unit === 'foreignCents' ? 'USD' : 'CNY',
        direction: 'signed',
        dimension: 'none',
        item: '',
      }),
      unit,
      currency: unit === 'foreignCents' ? 'USD' : 'CNY',
    },
  ];
  return app.call(reportServer).importTemplate(template);
}
const voucher = (
  date: string,
  fc: number,
  qty: string,
  side: 'debit' | 'credit' = 'debit',
  status: VoucherSpec['status'] = 'posted',
): VoucherSpec => ({
  date,
  status,
  lines: [
    {
      account: '100202',
      [side]: fc * 71,
      currency: 'USD',
      rate: '7.1',
      fcAmount: fc * 10,
      dims: { cashflow: 'CF01' },
    },
    { account: '1403', [side]: fc, quantity: qty, unitPrice: '1' },
    { account: '6001', [side === 'debit' ? 'credit' : 'debit']: fc * 72 },
  ],
});
for (const unit of ['foreignCents', 'quantity'] as const)
  for (const metric of ['ytdDebit', 'ytdCredit'] as const)
    it(`w_bb_proc ${unit} ${metric} 累计包括前月与红字，排除后月和未过账`, async () => {
      await seedVouchers(app.svc, [
        voucher('2026-01-05', 100, '1.234567'),
        voucher('2026-02-05', 30, '2.000001'),
        voucher('2026-02-06', -10, '-0.234567'),
        voucher('2026-02-07', 25, '0.500001', 'credit'),
        voucher('2026-02-08', 1000, '10', 'debit', 'pending'),
        voucher('2026-03-01', 1000, '10'),
      ]);
      const r = await report(unit, metric);
      const api = app.call(reportServer);
      const generated = await api.generate({
        id: r.id,
        expectedRevision: r.revision,
        period: 202602,
        requestId: randomUUID(),
        confirmUnposted: true,
      });
      if (generated.kind !== 'generated') throw new Error('意外确认');
      expect(generated.snapshot.cells[0]!.value).toBe(
        unit === 'foreignCents'
          ? metric === 'ytdDebit'
            ? '1200'
            : '250'
          : metric === 'ytdDebit'
            ? '3.000001'
            : '0.500001',
      );
      const included = await api.generate({
        id: r.id,
        expectedRevision: r.revision,
        period: 202602,
        requestId: randomUUID(),
        confirmUnposted: true,
        includeUnposted: true,
      });
      if (included.kind !== 'generated') throw new Error('意外确认');
      expect(included.snapshot.cells[0]!.value).toBe(
        metric === 'ytdCredit'
          ? unit === 'foreignCents'
            ? '250'
            : '0.500001'
          : unit === 'foreignCents'
            ? '11200'
            : '13.000001',
      );
      if (unit === 'foreignCents') {
        const cashReport = await api.save({
          id: r.id,
          expectedRevision: r.revision,
          template: {
            ...r.template,
            cells: [
              {
                ...r.template.cells[0]!,
                source: balanceFormula({
                  account: '100202',
                  unit,
                  metric,
                  currency: 'USD',
                  direction: 'signed',
                  dimension: 'cashflow',
                  item: 'CF01',
                }),
              },
            ],
          },
        });
        const cash = await api.generate({
          id: cashReport.id,
          expectedRevision: cashReport.revision,
          period: 202602,
          requestId: randomUUID(),
          confirmUnposted: true,
        });
        if (cash.kind !== 'generated') throw new Error('意外确认');
        expect(cash.snapshot.cells[0]!.value).toBe(metric === 'ytdDebit' ? '1200' : '250');
      }
    });
it.each(['foreignCents', 'quantity'] as const)(
  'w_bb_proc 年中启用的%s累计缺启用前来源时不按零输出',
  async (unit) => {
    await app.close();
    app = await createTestApp({ modules: [reportServer], startYear: 2026, startMonth: 3 });
    const r = await report(unit, 'ytdDebit');
    await expect(
      app.call(reportServer).generate({
        id: r.id,
        expectedRevision: r.revision,
        period: 202603,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('启用前外币或数量累计没有独立来源');
    expect(await app.call(reportServer).snapshot({ id: r.id, period: 202603 })).toBeNull();
  },
);

it('w_bb_proc 零本币外币分录按明确借贷侧计入现金流量累计', async () => {
  const accountId = (await app.svc.accounts.require('100202')).id;
  const cashflow = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  const voucher = await app.svc.vouchers.create({
    date: '2026-02-10',
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
    lines: [
      {
        accountId,
        summary: '零本币外币合成分录',
        debit: 0,
        credit: 0,
        entrySide: 'debit',
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 1000,
        dimensions: { cashflow },
      },
      {
        accountId,
        summary: '零本币外币合成分录',
        debit: 0,
        credit: 0,
        entrySide: 'credit',
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 500,
        dimensions: { cashflow },
      },
    ],
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
  const api = app.call(reportServer);
  let current = await report('foreignCents', 'ytdDebit');
  for (const metric of ['ytdDebit', 'ytdCredit'] as const) {
    current = await api.save({
      id: current.id,
      expectedRevision: current.revision,
      template: {
        ...current.template,
        cells: [
          {
            ...current.template.cells[0]!,
            source: balanceFormula({
              account: '100202',
              metric,
              unit: 'foreignCents',
              currency: 'USD',
              direction: 'signed',
              dimension: 'cashflow',
              item: 'CF01',
            }),
          },
        ],
      },
    });
    const generated = await api.generate({
      id: current.id,
      expectedRevision: current.revision,
      period: 202602,
      requestId: randomUUID(),
    });
    if (generated.kind !== 'generated') throw new Error('意外确认');
    expect(generated.snapshot.cells[0]!.value).toBe(metric === 'ytdDebit' ? '1000' : '500');
  }
});
