import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';

let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
  await book.svc.voucherPolicy.set({
    numbering: 'manual',
    renumberAfterDelete: false,
    allowModifyOthers: true,
  });
});
afterEach(async () => book.close());
const raw = async () => ({
  ...(await voucherInputFromSpec(book.svc, {
    date: '2026-01-05',
    lines: [
      { account: '1001', debit: 103 },
      { account: '6001', credit: 103 },
    ],
  })),
  number: await book.svc.vouchers.nextNumber(202601, 1),
});

describe('w_pz_pzxsb 来源凭证编号保护（PR111 反例）', () => {
  it.each(['pending', 'audited', 'posted'] as const)(
    '%s 的来源原编号7不能由手工入口改成8，历史仍可读取',
    async (status) => {
      const owner = book.forModule('legacy-import');
      const v = await owner.vouchers.create({
        ...(await raw()),
        number: 7,
        source: { type: 'import', id: 'synthetic-batch' },
      });
      if (status !== 'pending') await owner.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      if (status === 'posted') await owner.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
      const before = await book.svc.vouchers.get(v.id);
      await expect(book.svc.vouchers.setNumbers([{ id: v.id, number: 8 }])).rejects.toThrow(
        '不能在这里',
      );
      expect(await book.svc.vouchers.get(v.id)).toEqual(before);
    },
  );

  it('混合批次遇到来源锁整批不改；手工凭证单独改号仍可用', async () => {
    const manual = await book.svc.vouchers.create(await raw());
    const sourced = await book.forModule('legacy-import').vouchers.create({
      ...(await raw()),
      number: 7,
      source: { type: 'import', id: 'synthetic-batch' },
    });
    await expect(
      book.svc.vouchers.setNumbers([
        { id: manual.id, number: 2 },
        { id: sourced.id, number: 8 },
      ]),
    ).rejects.toThrow('不能在这里');
    expect(await book.svc.vouchers.get(manual.id)).toEqual(manual);
    expect(await book.svc.vouchers.get(sourced.id)).toEqual(sourced);
    const plan = await book.svc.vouchers.previewNumbers([{ id: manual.id, number: 2 }]);
    await book.svc.vouchers.setNumbers(plan.updates, { plan, confirmed: true });
    expect((await book.svc.vouchers.get(manual.id))!.number).toBe(2);
  });

  it('其他模块不能改号，来源所属模块沿用核心来源修改契约', async () => {
    const owner = book.forModule('legacy-import');
    const v = await owner.vouchers.create({
      ...(await raw()),
      number: 7,
      source: { type: 'import', id: 'synthetic-batch' },
    });
    await expect(
      book.forModule('voucher-book').vouchers.setNumbers([{ id: v.id, number: 8 }]),
    ).rejects.toThrow('不能在这里');
    const plan = await owner.vouchers.previewNumbers([{ id: v.id, number: 8 }]);
    await owner.vouchers.setNumbers(plan.updates, { plan, confirmed: true });
    expect((await book.svc.vouchers.get(v.id))!.number).toBe(8);
  });
});
