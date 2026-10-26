import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers } from '@caiwu/testkit';

/** 只通过 core 服务造前置；浏览器夹具也可在自己的临时账套使用。金额全部为分。 */
export async function seedBalanceCases(svc: CoreServices) {
  const account = async (code: string) => (await svc.accounts.require(code)).id;
  await svc.opening.upsert({ year: 2026, accountId: await account('100201'), balance: 10_000 });
  await svc.opening.upsert({
    year: 2026,
    accountId: await account('100202'),
    currency: 'USD',
    balance: 71_000,
    fcBalance: 10_000,
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: await account('1403'),
    balance: 20_000,
    quantity: '2.000001',
  });
  await svc.opening.upsert({ year: 2026, accountId: await account('4001'), balance: -101_000 });
  const bank = (debit: number) => [
    { account: '100201', debit },
    { account: '6001', credit: debit },
  ];
  await seedVouchers(svc, [
    { date: '2026-01-05', status: 'posted', lines: bank(100_000) },
    { date: '2026-02-05', status: 'posted', lines: bank(30_000) },
    { date: '2026-02-06', status: 'posted', lines: bank(-5_000) },
    {
      date: '2026-02-07',
      status: 'posted',
      lines: [
        { account: '6603', debit: 20_000 },
        { account: '100201', credit: 20_000 },
      ],
    },
    { date: '2026-02-08', status: 'pending', lines: bank(7_000) },
    { date: '2026-02-09', status: 'audited', lines: bank(11_000) },
    { date: '2026-02-10', status: 'draft', lines: bank(90_000) },
    {
      date: '2026-02-11',
      status: 'posted',
      lines: [
        { account: '100202', debit: 7_100, currency: 'USD', rate: '7.1', fcAmount: 1_000 },
        { account: '6001', credit: 7_100 },
      ],
    },
    {
      date: '2026-02-12',
      status: 'posted',
      lines: [
        { account: '1403', debit: 15_000, quantity: '1.500001' },
        { account: '2202', credit: 15_000, dims: { partner: 'S001' } },
      ],
    },
    {
      date: '2026-02-13',
      status: 'posted',
      lines: [
        { account: '6401', debit: 5_000 },
        { account: '1403', credit: 5_000, quantity: '0.500001' },
      ],
    },
    {
      date: '2026-02-14',
      status: 'posted',
      lines: [
        { account: '6602', debit: 1_234, dims: { department: '01' } },
        { account: '1001', credit: 1_234 },
      ],
    },
    {
      date: '2026-02-15',
      status: 'posted',
      lines: [
        { account: '5001', debit: 500, dims: { project: 'XM01' } },
        { account: '1001', credit: 500 },
      ],
    },
  ]);
  const [voided] = await seedVouchers(svc, [{ date: '2026-02-16', lines: bank(99_000) }]);
  await svc.vouchers.setVoided(voided!.id, true);
}
