import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';

/** 同一模块单测与独立浏览器账套使用的真实 core 凭证数据。 */
export async function seedLedgerBook(svc: CoreServices) {
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('1001')).id,
    balance: 50_000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('4001')).id,
    balance: -50_000,
  });
  const specs: VoucherSpec[] = [
    {
      date: '2026-01-05',
      summary: '前月收款',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10_000 },
        { account: '6001', credit: 10_000 },
      ],
    },
    {
      date: '2026-02-03',
      summary: '本月收款',
      status: 'posted',
      lines: [
        { account: '1001', debit: 2_500 },
        { account: '6001', credit: 2_500 },
      ],
    },
    {
      date: '2026-02-03',
      summary: '本月付款',
      status: 'posted',
      lines: [
        { account: '1001', credit: 1_000 },
        { account: '4001', debit: 1_000 },
      ],
    },
    {
      date: '2026-02-04',
      summary: '红字收款',
      status: 'posted',
      lines: [
        { account: '1001', debit: -200 },
        { account: '6001', credit: -200 },
      ],
    },
    {
      date: '2026-02-06',
      summary: '同凭证两行',
      status: 'posted',
      lines: [
        { account: '1001', debit: 100 },
        { account: '1001', debit: 200 },
        { account: '4001', credit: 300 },
      ],
    },
    {
      date: '2026-02-07',
      summary: '待审核付款',
      status: 'pending',
      lines: [
        { account: '1001', credit: 300 },
        { account: '4001', debit: 300 },
      ],
    },
    {
      date: '2026-02-08',
      summary: '已审核收款',
      status: 'audited',
      lines: [
        { account: '1001', debit: 400 },
        { account: '4001', credit: 400 },
      ],
    },
    {
      date: '2026-02-09',
      summary: '草稿不计入',
      status: 'draft',
      lines: [
        { account: '1001', debit: 999 },
        { account: '4001', credit: 999 },
      ],
    },
    {
      date: '2026-02-10',
      summary: '作废不计入',
      status: 'pending',
      lines: [
        { account: '1001', debit: 777 },
        { account: '4001', credit: 777 },
      ],
    },
    {
      date: '2026-02-11',
      summary: '美元收款',
      status: 'posted',
      lines: [
        { account: '100202', debit: 7_100, currency: 'USD', rate: '7.1', fcAmount: 1_000 },
        { account: '6051', credit: 7_100 },
      ],
    },
    {
      date: '2026-02-12',
      summary: '数量样本',
      status: 'posted',
      lines: [
        { account: '1403', debit: 12_345, quantity: '1.2345', unitPrice: '100' },
        { account: '4001', credit: 12_345 },
      ],
    },
    {
      date: '2026-02-13',
      summary: '客户应收',
      status: 'posted',
      lines: [
        { account: '1122', debit: 800, dims: { partner: 'C001' } },
        { account: '6001', credit: 800 },
      ],
    },
    {
      date: '2026-02-14',
      summary: '其他客供应收',
      status: 'posted',
      lines: [
        { account: '1122', debit: 200, dims: { partner: 'S001' } },
        { account: '6001', credit: 200 },
      ],
    },
    {
      date: '2026-02-15',
      summary: '银行付款',
      status: 'posted',
      lines: [
        { account: '100201', credit: 2_000 },
        { account: '4001', debit: 2_000 },
      ],
    },
  ];
  const vouchers = await seedVouchers(svc, specs);
  await svc.vouchers.setVoided(vouchers[8]!.id, true);
  const partner = (await svc.dimensions.getByCode('partner', 'C001'))!;
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('1122')).id,
    dimensions: { partner: partner.id },
    balance: 500,
  });
  return { vouchers, partnerId: partner.id };
}
