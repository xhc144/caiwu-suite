import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import type { Account } from '@caiwu/core';
import server from '../server';
import { foreignAmountIssues, referenceIssues, type ReferenceRow } from '../server/references';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
const row: ReferenceRow = {
  dim_project: null,
  dim_partner: null,
  dim_department: null,
  dim_person: null,
  currency_code: null,
  quantity_e6: 0,
};
const currencies = new Set(['CNY', 'USD']);

describe('w_zh_zhjc 辅助核算、外币及数量', () => {
  it('w_zh_zhjc 真实已过账数据及历史停用档案不误报；检查不写凭证、期初或日志', async () => {
    const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
    const receivable = await app.svc.accounts.require('1122');
    await app.svc.opening.upsert({
      year: 2026,
      accountId: receivable.id,
      dimensions: { partner: partner.id },
      balance: 0,
    });
    const [voucher] = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1122', dims: { partner: 'C001' }, debit: 90 },
          { account: '100202', currency: 'USD', rate: '7.1', fcAmount: 100, debit: 710 },
          { account: '1403', quantity: '2.5', debit: 200 },
          { account: '6001', credit: 1000 },
        ],
      },
    ]);
    await app.svc.db
      .updateTable('dimension_item')
      .set({ disabled: 1 })
      .where('id', '=', partner.id)
      .execute();
    await app.svc.db
      .updateTable('account')
      .set({ disabled: 1 })
      .where('id', '=', receivable.id)
      .execute();
    await app.svc.db
      .updateTable('currency')
      .set({ disabled: 1 })
      .where('code', '=', 'USD')
      .execute();
    const before = {
      voucher: await app.svc.vouchers.get(voucher!.id),
      opening: await app.svc.opening.list(2026),
      logs: await app.svc.log.list(),
    };
    const checks = await app.call(server).checks();
    expect(checks.filter((r) => r.category === '分录核算项')).toHaveLength(4);
    expect(
      checks
        .filter((r) => ['分录核算项', '期初核算项'].includes(r.category))
        .every((r) => r.status === '通过'),
    ).toBe(true);
    expect(await app.svc.vouchers.get(voucher!.id)).toEqual(before.voucher);
    expect(await app.svc.opening.list(2026)).toEqual(before.opening);
    expect(await app.svc.log.list()).toEqual(before.logs);
    // 只改合成档案类型，不直接写凭证/分录；真实检查应能定位旧引用。
    await app.svc.db
      .updateTable('dimension_item')
      .set({ type_id: 'project' })
      .where('id', '=', partner.id)
      .execute();
    const failed = (await app.call(server).checks()).filter((r) => r.message.includes('类型不符'));
    expect(failed.map((r) => r.category).sort()).toEqual(['分录核算项', '期初核算项']);
    expect(failed.find((r) => r.category === '分录核算项')?.to).toBe(
      `/m/voucher-entry/edit?id=${voucher!.id}`,
    );
    expect(await app.svc.vouchers.get(voucher!.id)).toEqual(before.voucher);
  });

  it('w_zh_zhjc 期初通过 core 造数，非法外币及数量定位到科目和期初 ID', async () => {
    const cash = await app.svc.accounts.require('1001');
    await app.svc.opening.upsert({
      year: 2026,
      accountId: cash.id,
      balance: 0,
      currency: 'USD',
      fcBalance: 15,
      quantity: '0.25',
    });
    const checks = await app.call(server).checks();
    const issue = checks.find((r) => r.category === '期初核算项')!;
    expect(issue.status).toBe('不通过');
    expect(issue.target).toContain('1001 / 期初 ID');
    expect(issue.message).toContain('币种与科目外币核算设置不符');
    expect(issue.message).toContain('非数量科目存有数量');
    expect(issue.message).toContain('外币余额缺少对应的科目币种');
    expect(issue.to).toBe('/m/opening?year=2026');
  });

  it('w_zh_zhjc 损坏快照：辅助项缺失、错类型、非末级、科目未启用与必填缺失分别报告', async () => {
    const account = await app.svc.accounts.require('1122');
    const options = { opening: true };
    expect(
      referenceIssues({ ...row, dim_partner: 999 }, account, new Map(), currencies, options),
    ).toContain('客户/供应商 ID 999 不存在');
    expect(
      referenceIssues(
        { ...row, dim_partner: 1 },
        account,
        new Map([[1, { id: 1, type_id: 'project', is_leaf: 1 }]]),
        currencies,
        options,
      ),
    ).toContain('客户/供应商 ID 1 类型不符');
    const items = new Map([[1, { id: 1, type_id: 'partner', is_leaf: 0 }]]);
    expect(
      referenceIssues({ ...row, dim_partner: 1 }, account, items, currencies, options),
    ).toContain('客户/供应商 ID 1 不是末级');
    expect(
      referenceIssues(
        { ...row, dim_partner: 1 },
        { ...account, dimensions: [] },
        items,
        currencies,
        options,
      ),
    ).toContain('科目未启用客户/供应商核算');
    expect(referenceIssues(row, account, items, currencies, options)).toContain(
      '缺少必填客户/供应商',
    );
    expect(
      referenceIssues(row, account, items, currencies, { opening: false, draft: true }),
    ).not.toContain('缺少必填客户/供应商');
    expect(
      referenceIssues(row, { ...account, isLeaf: false }, items, currencies, options),
    ).toContain('引用非末级科目');
    // core 不把缺失现金流量项目作为必填分录错误，不能在检查时另加阻止规则。
    expect(
      referenceIssues(
        row,
        {
          ...account,
          dimensions: [{ type: 'cashflow', required: true, defaultItemId: null }],
        },
        items,
        currencies,
        { opening: false },
      ),
    ).toEqual([]);
  });

  it('w_zh_zhjc 损坏快照：外币不存在、不匹配、金额溢出、汇率非法及正式分录缺项', async () => {
    const account = await app.svc.accounts.require('100202');
    expect(
      referenceIssues({ ...row, currency_code: 'XXX' }, account, new Map(), currencies, {
        opening: false,
      }),
    ).toEqual(expect.arrayContaining(['币种 XXX 不存在', '币种与科目外币核算设置不符']));
    expect(
      foreignAmountIssues(
        { currency_code: null, fc_amount: null, exchange_rate: null },
        account,
        false,
      ),
    ).toEqual(['外币科目缺少币种', '外币科目缺少外币金额', '外币科目缺少汇率']);
    expect(
      foreignAmountIssues(
        { currency_code: null, fc_amount: null, exchange_rate: null },
        account,
        true,
      ),
    ).toEqual([]);
    for (const rate of ['0', '-1', 'NaN', 'Infinity', '1e3', '错误'])
      expect(
        foreignAmountIssues(
          { currency_code: 'USD', fc_amount: 0, exchange_rate: rate },
          account,
          false,
        ),
      ).toContain('汇率不是正十进制数');
    for (const amount of [0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        foreignAmountIssues(
          { currency_code: 'USD', fc_amount: amount, exchange_rate: '7.1' },
          account,
          false,
        ),
      ).toContain('外币金额不是安全整数分');
  });

  it('w_zh_zhjc 任意安全整数数量及外币金额不经浮点缩放；非整数与溢出不可通过', async () => {
    const base = await app.svc.accounts.require('1403');
    const account: Account = { ...base, currency: 'USD' };
    fc.assert(
      fc.property(
        fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
        (value) => {
          expect(
            referenceIssues(
              { ...row, currency_code: 'USD', quantity_e6: value },
              account,
              new Map(),
              currencies,
              { opening: false },
            ),
          ).toEqual([]);
          expect(
            foreignAmountIssues(
              { currency_code: 'USD', fc_amount: value, exchange_rate: '7.100000000000000001' },
              account,
              false,
            ),
          ).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
    for (const quantity of [0.1, Number.MAX_SAFE_INTEGER + 1])
      expect(
        referenceIssues({ ...row, quantity_e6: quantity }, account, new Map(), currencies, {
          opening: false,
        }),
      ).toContain('数量不是安全整数百万分之一');
  });
});
