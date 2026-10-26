import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';

let book: TestBook;
let methodId: number;
beforeEach(async () => {
  book = await createTestBook();
  methodId = (
    await book.svc.db
      .insertInto('settlement_method')
      .values({
        code: 'reference-test',
        name: '测试结算方式',
        disabled: 0,
        sort: 99,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
});
afterEach(async () => book.close());

async function input() {
  const raw = await voucherInputFromSpec(book.svc, {
    date: '2026-01-05',
    lines: [
      { account: '100202', debit: 7100, currency: 'USD', rate: '7.1', fcAmount: 1000 },
      { account: '6001', credit: 7100 },
    ],
  });
  return {
    ...raw,
    lines: raw.lines.map((line, i) => (i === 0 ? { ...line, settlementMethodId: methodId } : line)),
  };
}
async function disable(kind: '币种' | '结算方式', disabled = 1) {
  if (kind === '币种')
    await book.svc.db.updateTable('currency').set({ disabled }).where('code', '=', 'USD').execute();
  else
    await book.svc.db
      .updateTable('settlement_method')
      .set({ disabled })
      .where('id', '=', methodId)
      .execute();
}

describe('w_xt_fbwh / w_xt_jslb / w_pz_pzedit 停用参照保存保护', () => {
  it.each([
    ['币种', false],
    ['币种', true],
    ['结算方式', false],
    ['结算方式', true],
  ] as const)('%s 停用后拒绝新保存，draft=%s，不遗留凭证或消耗编号', async (kind, draft) => {
    const raw = await input();
    await disable(kind);
    await expect(book.svc.vouchers.create({ ...raw, draft })).rejects.toThrow(
      kind === '币种' ? /币种.*已停用/ : /结算方式.*已停用/,
    );
    expect((await book.svc.vouchers.list()).total).toBe(0);
    expect(await book.svc.vouchers.nextNumber(202601, raw.voucherTypeId)).toBe(1);
  });

  it('科目隐含的外币也检查停用，省略分录currency不能绕过', async () => {
    const raw = await input();
    raw.lines[0]!.currency = null;
    await disable('币种');
    await expect(book.svc.vouchers.create(raw)).rejects.toThrow(/币种 USD.*已停用/);
    expect((await book.svc.vouchers.list()).total).toBe(0);
  });

  it.each(['币种', '结算方式'] as const)(
    '%s 停用拒绝新修改版本，原凭证及分录完整保留',
    async (kind) => {
      const raw = await input();
      const original = await book.svc.vouchers.create(raw);
      await disable(kind);
      const changed = {
        ...raw,
        lines: raw.lines.map((line) => ({ ...line, summary: '不应保存的新摘要' })),
      };
      await expect(
        book.svc.vouchers.update(original.id, changed, { expectedRevision: original.revision }),
      ).rejects.toThrow(kind === '币种' ? /币种.*已停用/ : /结算方式.*已停用/);
      expect(await book.svc.vouchers.get(original.id)).toEqual(original);
    },
  );

  it.each(['币种', '结算方式'] as const)(
    '%s 校验失败回滚同一真实事务中已创建的前一张凭证',
    async (kind) => {
      const invalid = await input();
      const valid = await voucherInputFromSpec(book.svc, {
        date: '2026-01-05',
        lines: [
          { account: '1001', debit: 103 },
          { account: '6001', credit: 103 },
        ],
      });
      await disable(kind);
      await expect(
        book.svc.tx(async (svc) => {
          await svc.vouchers.create(valid);
          await svc.vouchers.create(invalid);
        }),
      ).rejects.toThrow(kind === '币种' ? /币种.*已停用/ : /结算方式.*已停用/);
      expect((await book.svc.vouchers.list()).total).toBe(0);
      expect((await book.svc.vouchers.create(valid)).number).toBe(1);
    },
  );

  it('已保存的参照停用后仍可读取并按原状态流程过账，历史外币余额保持精确', async () => {
    const original = await book.svc.vouchers.create(await input());
    await disable('币种');
    await disable('结算方式');
    expect(await book.svc.vouchers.get(original.id)).toEqual(original);
    expect(await book.svc.reference.currencies()).toContainEqual(
      expect.objectContaining({ code: 'USD', disabled: true }),
    );
    expect(await book.svc.reference.settlementMethods()).toContainEqual(
      expect.objectContaining({ id: methodId, disabled: true }),
    );
    await book.svc.vouchers.changeStatus({ ids: [original.id], to: 'audited' });
    await book.svc.vouchers.changeStatus({ ids: [original.id], to: 'posted' });
    expect((await book.svc.vouchers.get(original.id))!.lines[0]).toMatchObject({
      currency: 'USD',
      fcAmount: 1000,
      settlementMethodId: methodId,
    });
    expect(
      (
        await book.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['100202'],
          currency: 'USD',
          rollup: false,
        })
      )[0],
    ).toMatchObject({ debit: 7100, closing: 7100, fcDebit: 1000, fcClosing: 1000 });
  });

  it('重新启用后新保存恢复可用，同一服务对象不能缓存旧的停用状态', async () => {
    const raw = await input();
    await disable('币种');
    await disable('结算方式');
    await expect(book.svc.vouchers.create(raw)).rejects.toThrow(/已停用/);
    await disable('币种', 0);
    await disable('结算方式', 0);
    expect((await book.svc.vouchers.create(raw)).lines[0]).toMatchObject({
      currency: 'USD',
      fcAmount: 1000,
      settlementMethodId: methodId,
    });
  });

  it('不存在的结算方式返回有行号的业务错误，不让外键异常代替校验', async () => {
    const raw = await input();
    const changed = {
      ...raw,
      lines: raw.lines.map((line, i) => (i === 0 ? { ...line, settlementMethodId: 999999 } : line)),
    };
    await expect(book.svc.vouchers.create(changed)).rejects.toThrow(/第1行：结算方式.*不存在/);
    expect((await book.svc.vouchers.list()).total).toBe(0);
  });
});
