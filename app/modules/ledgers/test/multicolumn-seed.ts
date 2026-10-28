import { parseCodeScheme } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';

/** 两级分栏、三种辅助对象（含未指定）、红字和不同凭证状态的合成账套。 */
export async function seedMultiBook(svc: CoreServices) {
  const scheme = parseCodeScheme('4-2-2');
  for (const [code, name] of [
    ['660101', '差旅费'],
    ['66010101', '市内差旅'],
    ['660102', '办公费'],
  ])
    await svc.accounts.create(
      { code: code!, name: name!, dimensions: [{ type: 'department', required: false }] },
      scheme,
    );
  const department = (await svc.dimensions.getByCode('department', '01'))!;
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('66010101')).id,
    balance: 500,
    dimensions: { department: department.id },
  });
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require('660102')).id,
    balance: 700,
  });
  const expense = (
    date: string,
    account: string,
    debit: number,
    department?: string,
    status: VoucherSpec['status'] = 'posted',
    credit = 0,
  ): VoucherSpec => ({
    date,
    status,
    summary: `合成费用 ${debit || -credit}`,
    lines: [
      { account, debit, credit, ...(department ? { dims: { department } } : {}) },
      { account: '4001', debit: credit, credit: debit },
    ],
  });
  const vouchers = await seedVouchers(svc, [
    expense('2026-01-05', '66010101', 100, '01'),
    expense('2026-02-03', '66010101', 300, '01'),
    expense('2026-02-04', '660102', 400, '02'),
    expense('2026-02-05', '66010101', 0, '01', 'posted', 50),
    expense('2026-02-06', '660102', -20, '02'),
    expense('2026-02-07', '66010101', 90),
    expense('2026-02-08', '660102', 10, '02', 'pending'),
    expense('2026-02-09', '66010101', 15, '01', 'audited'),
    expense('2026-02-10', '660102', 999, '02', 'draft'),
    expense('2026-02-11', '66010101', 999, '01', 'pending'),
  ]);
  await svc.vouchers.setVoided(vouchers[9]!.id, true);
  return { departmentId: department.id, vouchers };
}
