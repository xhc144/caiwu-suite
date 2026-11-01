import { afterEach, expect, it } from 'vitest';
import { createTestApp, voucherInputFromSpec, type TestApp } from '@caiwu/testkit';
import analysis from '../server';
import { BucketBoundsSchema, ORIGINAL_AGING_BOUNDS } from '../shared';
import { allocateFifo, bucketLabels } from '../server/fifo';

let app: TestApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

it('w_fx_zl 原版15桶连续且无重叠：0–30、31–60、61–90至1096天以上', () => {
  expect(BucketBoundsSchema.safeParse(ORIGINAL_AGING_BOUNDS).success).toBe(true);
  expect(BucketBoundsSchema.safeParse([...ORIGINAL_AGING_BOUNDS, 1200]).success).toBe(false);
  const labels = bucketLabels(ORIGINAL_AGING_BOUNDS);
  expect(labels).toHaveLength(15);
  expect(labels.slice(0, 3)).toEqual(['0–30天', '31–60天', '61–90天']);
  expect(labels.slice(-3)).toEqual(['366–730天', '731–1095天', '1096天及以上']);
  const ages = [0, 30, 31, 60, 61, 1095, 1096];
  const cutoff = '2026-04-15';
  const lots = ages.map((age, i) => ({
    lineId: i + 1,
    voucherId: i + 1,
    voucherNo: '合成边界凭证',
    date: cutoff,
    bizDate: new Date(Date.parse(`${cutoff}T00:00:00Z`) - age * 86400000)
      .toISOString()
      .slice(0, 10),
    amount: (i + 1) * 100,
    remaining: 0,
  }));
  const result = allocateFifo(lots, cutoff, ORIGINAL_AGING_BOUNDS);
  expect(result.buckets).toEqual([300, 700, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 600, 700]);
  expect(result.allocated).toBe(2800);
});

it('w_fx_zl 15桶设置真实保存、关闭重开回读，金额仍取已过账合成凭证', async () => {
  app = await createTestApp({ modules: [analysis] });
  const api = app.call(analysis);
  const input = await voucherInputFromSpec(app.svc, {
    date: '2026-04-15',
    lines: [
      { account: '1122', debit: 12345, dims: { partner: 'C001' } },
      { account: '6001', credit: 12345 },
    ],
  });
  const voucher = await app.svc.vouchers.create({
    ...input,
    lines: input.lines.map((line, index) => ({
      ...line,
      bizDate: index === 0 ? '2026-03-15' : null,
    })),
  });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
  await api.saveConfig({ bounds: ORIGINAL_AGING_BOUNDS, expectedRevision: 0 });
  await app.runtime.bookStore.closeAll();
  const saved = await api.config();
  expect(saved.bounds).toEqual(ORIGINAL_AGING_BOUNDS);
  const report = await api.aging({
    accountCode: '1122',
    cutoff: '2026-04-15',
    bounds: saved.bounds,
  });
  expect(report.bucketLabels).toHaveLength(15);
  expect(report.rows[0]!.buckets[1]).toBe(12345);
  expect(report.totals.ledger).toBe(12345);
  expect(report.totals.difference).toBe(0);
});
