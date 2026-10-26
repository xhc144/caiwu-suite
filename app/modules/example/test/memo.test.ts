import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TRPCError } from '@trpc/server';
import type { BusinessError } from '@caiwu/core';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import exampleServer from '../server';

// 模块测试的写法：createTestApp 建好真实账套并以管理员登录，app.call(模块) 调本模块接口。
let app: TestApp;
let api: ReturnType<TestApp['call']> & ReturnType<typeof callExample>;
const callExample = (a: TestApp, token?: string) => a.call(exampleServer, token);

beforeEach(async () => {
  app = await createTestApp({ modules: [exampleServer] });
  api = callExample(app) as typeof api;
});
afterEach(async () => app.close());

async function ids() {
  const acc = async (code: string) => (await app.svc.accounts.require(code)).id;
  const dept = (await app.svc.dimensions.getByCode('department', '01'))!.id;
  return {
    mgmt: await acc('6602'),
    cash: await acc('1001'),
    finance: await acc('6603'),
    parent: await acc('1002'),
    dept,
  };
}

async function businessCode(p: Promise<unknown>) {
  const e = (await p.then(
    () => null,
    (x: unknown) => x,
  )) as TRPCError | null;
  expect(e).not.toBeNull();
  return (e!.cause as BusinessError).data;
}

describe('示范记账单', () => {
  it('新增、生成凭证、删除凭证', async () => {
    const a = await ids();
    const memo = await api.memos.create({
      date: '2026-01-10',
      summary: '购买办公用品',
      debitAccountId: a.mgmt,
      creditAccountId: a.cash,
      amount: 356_00,
      departmentId: a.dept,
    });
    expect(memo).toMatchObject({
      summary: '购买办公用品',
      voucherId: null,
      departmentName: '行政部',
    });

    const done = await api.memos.generateVoucher({ id: memo.id });
    expect(done.voucherNo).toBe('记-0001');
    expect(done.voucherStatus).toBe('待审核');
    const v = (await app.svc.vouchers.get(done.voucherId!))!;
    expect(v.source).toEqual({ module: 'example', type: 'memo', id: String(memo.id) });
    expect(v.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['6602', 356_00, 0],
      ['1001', 0, 356_00],
    ]);

    const back = await api.memos.deleteVoucher({ id: memo.id });
    expect(back.voucherId).toBeNull();
    expect(await app.svc.vouchers.get(v.id)).toBeNull();
  });

  it('已生成凭证的记账单不能改、不能删；凭证审核后不能删凭证', async () => {
    const a = await ids();
    const input = {
      date: '2026-01-10',
      summary: '利息',
      debitAccountId: a.finance,
      creditAccountId: a.cash,
      amount: 10_00,
    };
    const memo = await api.memos.create(input);
    await api.memos.generateVoucher({ id: memo.id });
    const err = await businessCode(api.memos.update({ id: memo.id, data: input }));
    expect(err.code).toBe('EXAMPLE_MEMO_HAS_VOUCHER');
    expect(err.actions?.[0]?.to).toMatch(/^\/m\/voucher-entry\/edit\?id=/);
    expect((await businessCode(api.memos.remove({ id: memo.id }))).code).toBe(
      'EXAMPLE_MEMO_HAS_VOUCHER',
    );

    const voucherId = (await api.memos.list({ id: memo.id }))[0]!.voucherId!;
    await app.svc.vouchers.changeStatus({ ids: [voucherId], to: 'audited' });
    const locked = await businessCode(api.memos.deleteVoucher({ id: memo.id }));
    expect(locked.code).toBe('VOUCHER_LOCKED');
    expect(locked.hint).toMatch(/取消审核/);
    // 凭证管理那边也不能删这张凭证：它属于示范模块
    await expect(app.svc.vouchers.delete(voucherId)).rejects.toThrow(/由「示范模块」生成/);
  });

  it('校验：非末级科目、借贷同科目、必填部门', async () => {
    const a = await ids();
    const base = { date: '2026-01-10', summary: 'x', amount: 1_00 };
    expect(
      (
        await businessCode(
          api.memos.create({ ...base, debitAccountId: a.parent, creditAccountId: a.cash }),
        )
      ).code,
    ).toBe('EXAMPLE_NOT_LEAF');
    expect(
      (
        await businessCode(
          api.memos.create({ ...base, debitAccountId: a.cash, creditAccountId: a.cash }),
        )
      ).code,
    ).toBe('EXAMPLE_SAME_ACCOUNT');
    expect(
      (
        await businessCode(
          api.memos.create({ ...base, debitAccountId: a.mgmt, creditAccountId: a.cash }),
        )
      ).code,
    ).toBe('EXAMPLE_DEPT_REQUIRED');
    // 输入格式错误（zod 校验）是 BAD_REQUEST；前端会显示成「提交的数据不合法：金额必须大于 0」
    await expect(
      api.memos.create({ ...base, amount: 0, debitAccountId: a.finance, creditAccountId: a.cash }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('权限：只有查看权限的用户不能新增', async () => {
    const viewer = callExample(
      app,
      await app.addUser('viewer', { permissions: ['example.memo.view'] }),
    );
    expect(await viewer.memos.list({})).toEqual([]);
    const a = await ids();
    const err = await businessCode(
      viewer.memos.create({
        date: '2026-01-10',
        summary: 'x',
        amount: 1_00,
        debitAccountId: a.finance,
        creditAccountId: a.cash,
      }),
    );
    expect(err.code).toBe('FORBIDDEN');
  });
});
