import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BusinessError } from '../src';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';

let t: TestBook;
beforeEach(async () => {
  t = await createTestBook();
});
afterEach(async () => {
  await t.close();
});

const cashSale = {
  date: '2026-01-05',
  summary: '销售收款',
  lines: [
    { account: '1001', debit: 1000_00 },
    { account: '6001', credit: 1000_00 },
  ],
};

async function expectBusiness(p: Promise<unknown>, code: string, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BusinessError);
  expect((err as BusinessError).data.code).toBe(code);
  if (message) expect((err as BusinessError).message).toMatch(message);
  return err as BusinessError;
}

describe('新增凭证', () => {
  it('同侧红字抵销前的累计超过安全范围也不丢分，最终越界拒绝写入', async () => {
    const n = Number.MAX_SAFE_INTEGER;
    const input = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: n },
        { account: '1001', debit: 2 },
        { account: '1001', debit: -n },
        { account: '4001', credit: 2 },
      ],
    });
    const v = await t.svc.vouchers.create(input);
    expect(v.debitTotal).toBe(2);
    const unsafe = { ...input, lines: input.lines.filter((_, i) => i !== 2) };
    await expectBusiness(t.svc.vouchers.create(unsafe), 'VOUCHER_INVALID', /安全整数范围/);
    const wideDifference = {
      ...input,
      lines: [input.lines[0]!, { ...input.lines[3]!, credit: -n }],
    };
    await expectBusiness(
      t.svc.vouchers.create(wideDifference),
      'VOUCHER_INVALID',
      /差额 超出安全整数范围/,
    );
    expect((await t.svc.vouchers.list()).total).toBe(1);
  });
  it('分配编号、状态为待审核、写操作日志', async () => {
    const [a] = await seedVouchers(t.svc, [cashSale]);
    const [b] = await seedVouchers(t.svc, [cashSale]);
    expect(a!.status).toBe('pending');
    expect(a!.number).toBe(1);
    expect(b!.number).toBe(2);
    expect(a!.displayNo).toBe('记-0001');
    expect(a!.debitTotal).toBe(1000_00);
    expect(a!.summary).toBe('销售收款');
    expect(a!.lines[0]!.accountName).toBe('库存现金');
    const logs = await t.svc.log.list({ targetType: 'voucher', targetId: a!.id });
    expect(logs[0]!.summary).toMatch(/新增凭证 记-0001/);
  });

  it('借贷不平衡时拒绝，并说明差额', async () => {
    const input = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 100_00 },
        { account: '6001', credit: 90_00 },
      ],
    });
    const err = await expectBusiness(
      t.svc.vouchers.create(input),
      'VOUCHER_INVALID',
      /借贷不平衡.*差额 10\.00/,
    );
    expect(err.data.hint).toMatch(/草稿/);
  });

  it('非末级科目、必填辅助核算、未启用的辅助核算都会被指出行号', async () => {
    const parent = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1002', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    });
    await expectBusiness(
      t.svc.vouchers.create(parent),
      'VOUCHER_INVALID',
      /第1行：科目 1002 银行存款 不是末级科目/,
    );

    const missingPartner = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1122', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    });
    await expectBusiness(
      t.svc.vouchers.create(missingPartner),
      'VOUCHER_INVALID',
      /第1行：.*需要填写客户\/供应商/,
    );

    const extraDim = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1001', debit: 100, dims: { department: '01' } },
        { account: '6001', credit: 100 },
      ],
    });
    await expectBusiness(t.svc.vouchers.create(extraDim), 'VOUCHER_INVALID', /没有启用部门核算/);
  });

  it('外币科目要有汇率和外币金额，数量科目要有数量', async () => {
    const noRate = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '100202', debit: 710_00 },
        { account: '6001', credit: 710_00 },
      ],
    });
    await expectBusiness(t.svc.vouchers.create(noRate), 'VOUCHER_INVALID', /外币科目/);
    const noQty = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1403', debit: 50_00 },
        { account: '2202', credit: 50_00, dims: { partner: 'S001' } },
      ],
    });
    await expectBusiness(t.svc.vouchers.create(noQty), 'VOUCHER_INVALID', /数量核算/);
    const [ok] = await seedVouchers(t.svc, [
      {
        date: '2026-01-05',
        lines: [
          { account: '100202', debit: 710_00, currency: 'USD', rate: '7.1', fcAmount: 100_00 },
          { account: '1403', debit: 50_00, quantity: '12.5', unitPrice: '4' },
          { account: '6001', credit: 760_00 },
        ],
      },
    ]);
    expect(ok!.lines[0]!.currency).toBe('USD');
    expect(ok!.lines[1]!.quantity).toBe('12.5');
  });

  it('草稿不校验平衡、没有编号，丢弃没选科目的行', async () => {
    const input = await voucherInputFromSpec(t.svc, {
      date: '2026-01-05',
      status: 'draft',
      lines: [{ account: '1001', debit: 100 }],
    });
    input.lines.push({ ...input.lines[0]!, accountId: null as unknown as number });
    const v = await t.svc.vouchers.create(input);
    expect(v.status).toBe('draft');
    expect(v.number).toBeNull();
    expect(v.displayNo).toBe('记-草稿');
    expect(v.lines).toHaveLength(1);
  });

  it('期间已结账或不存在时拒绝', async () => {
    await t.svc.periods.setStatus(202601, 'closed');
    const input = await voucherInputFromSpec(t.svc, cashSale);
    const err = await expectBusiness(
      t.svc.vouchers.create(input),
      'PERIOD_CLOSED',
      /2026年01月已经结账/,
    );
    expect(err.data.actions?.[0]?.to).toBe('/m/period-close');
    await expectBusiness(
      t.svc.vouchers.create({ ...input, date: '2027-01-05' }),
      'PERIOD_NOT_FOUND',
      /2027年01月还没有建立/,
    );
  });
});

describe('修改、删除、状态', () => {
  it('修改要带 revision，过期时拒绝', async () => {
    const [v] = await seedVouchers(t.svc, [cashSale]);
    const input = await voucherInputFromSpec(t.svc, { ...cashSale, summary: '改过的摘要' });
    const updated = await t.svc.vouchers.update(v!.id, input, { expectedRevision: v!.revision });
    expect(updated.summary).toBe('改过的摘要');
    expect(updated.number).toBe(1);
    expect(updated.revision).toBe(v!.revision + 1);
    await expectBusiness(
      t.svc.vouchers.update(v!.id, input, { expectedRevision: v!.revision }),
      'VOUCHER_STALE',
    );
  });

  it('草稿转正式时分配编号', async () => {
    const [draft] = await seedVouchers(t.svc, [{ ...cashSale, status: 'draft' }]);
    const input = await voucherInputFromSpec(t.svc, cashSale);
    const v = await t.svc.vouchers.update(draft!.id, input, { expectedRevision: draft!.revision });
    expect(v.status).toBe('pending');
    expect(v.number).toBe(1);
  });

  it('审核 → 过账 → 反过账 → 取消审核，记录审核人、过账人；已审核不能改、不能删', async () => {
    const [v] = await seedVouchers(t.svc, [cashSale]);
    const auditor = await t.addUser('kj', { name: '会计' });
    await auditor.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    let cur = (await t.svc.vouchers.get(v!.id))!;
    expect(cur.status).toBe('audited');
    expect(cur.auditedBy?.name).toBe('会计');
    const input = await voucherInputFromSpec(t.svc, cashSale);
    const locked = await expectBusiness(
      t.svc.vouchers.update(v!.id, input, { expectedRevision: cur.revision }),
      'VOUCHER_LOCKED',
      /已审核的凭证不能修改/,
    );
    expect(locked.data.hint).toMatch(/取消审核/);
    await expectBusiness(t.svc.vouchers.delete(v!.id), 'VOUCHER_LOCKED');
    await t.svc.vouchers.changeStatus({ ids: [v!.id], to: 'posted' });
    cur = (await t.svc.vouchers.get(v!.id))!;
    expect(cur.postedBy?.name).toBe('系统管理员');
    await expectBusiness(
      t.svc.vouchers.changeStatus({ ids: [v!.id], to: 'pending' }),
      'VOUCHER_STATUS_INVALID',
    );
    await t.svc.vouchers.changeStatus({ ids: [v!.id], to: 'audited' });
    await t.svc.vouchers.changeStatus({ ids: [v!.id], to: 'pending' });
    cur = (await t.svc.vouchers.get(v!.id))!;
    expect(cur.status).toBe('pending');
    expect(cur.auditedBy).toBeNull();
    expect(cur.postedBy).toBeNull();
  });

  it('批量状态变更全部成功或全部不变', async () => {
    const [a, b] = await seedVouchers(t.svc, [cashSale, { ...cashSale, status: 'audited' }]);
    await expectBusiness(
      t.svc.vouchers.changeStatus({ ids: [a!.id, b!.id], to: 'audited' }),
      'VOUCHER_STATUS_INVALID',
    );
    expect((await t.svc.vouchers.get(a!.id))!.status).toBe('pending');
  });

  it('模块生成的凭证只能由该模块修改删除，提示跳转到来源单据', async () => {
    const lookup = {
      manifest: (id: string) =>
        id === 'cashier'
          ? ({
              id: 'cashier',
              name: '出纳',
              sources: [{ type: 'document', name: '出纳单据', path: '/documents?id={id}' }],
            } as never)
          : undefined,
      permissionName: () => undefined,
    };
    const t2 = await createTestBook({ modules: lookup });
    try {
      const cashier = t2.forModule('cashier');
      const input = await voucherInputFromSpec(cashier, cashSale);
      const v = await cashier.vouchers.create({ ...input, source: { type: 'document', id: '42' } });
      expect(v.source).toEqual({ module: 'cashier', type: 'document', id: '42' });
      const err = await expectBusiness(
        t2.svc.vouchers.delete(v.id),
        'VOUCHER_FROM_SOURCE',
        /由「出纳」生成/,
      );
      expect(err.data.actions?.[0]?.to).toBe('/m/cashier/documents?id=42');
      await cashier.vouchers.delete(v.id);
      await expect(
        t2.svc.vouchers.create({ ...input, source: { type: 'x', id: '1' } }),
      ).rejects.toThrow(/只有业务模块/);
    } finally {
      await t2.close();
    }
  });

  it('作废与断号整理', async () => {
    const [a, b, c] = await seedVouchers(t.svc, [cashSale, cashSale, cashSale]);
    await t.svc.vouchers.delete(b!.id);
    const plan = await t.svc.vouchers.previewNumbers([{ id: c!.id, number: 2 }]);
    await expect(t.svc.vouchers.setNumbers(plan.updates)).rejects.toThrow(/确认/);
    await t.svc.vouchers.setNumbers(plan.updates, { plan, confirmed: true });
    expect((await t.svc.vouchers.get(c!.id))!.number).toBe(2);
    const voided = await t.svc.vouchers.setVoided(a!.id, true);
    expect(voided.voided).toBe(true);
    const list = await t.svc.vouchers.list({ periodFrom: 202601, periodTo: 202601 });
    expect(list.items.map((v) => v.id)).toEqual([c!.id]);
    const all = await t.svc.vouchers.list({ includeVoided: true });
    expect(all.total).toBe(2);
  });

  it('列表按科目、摘要、状态过滤', async () => {
    await seedVouchers(t.svc, [
      cashSale,
      {
        date: '2026-01-06',
        summary: '采购原料',
        status: 'posted',
        lines: [
          { account: '1403', debit: 50_00, quantity: '10' },
          { account: '2202', credit: 50_00, dims: { partner: 'S001' } },
        ],
      },
    ]);
    expect((await t.svc.vouchers.list({ accountCode: '14' })).items.map((v) => v.summary)).toEqual([
      '采购原料',
    ]);
    expect((await t.svc.vouchers.list({ summaryContains: '收款' })).total).toBe(1);
    expect((await t.svc.vouchers.list({ statuses: ['posted'] })).total).toBe(1);
  });
});
