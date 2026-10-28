import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { Decimal, type VoucherLineInput } from '@caiwu/core';
import { buildSpecialtyReport } from '../server/specialty';
import { QuerySchema, type LedgerQuery } from '../shared';
import { seedLedgerBook } from './seed';

let book: TestBook;
beforeEach(async () => {
  book = await createTestBook();
});
afterEach(async () => {
  await book?.close();
});
const query = (patch: Partial<LedgerQuery> = {}) =>
  QuerySchema.parse({
    kind: 'quantity',
    periodFrom: 202601,
    periodTo: 202601,
    account: '1403',
    ...patch,
  });
const report = (patch: Partial<LedgerQuery> = {}) =>
  book
    .forModule('ledgers')
    .tx(async (svc) => buildSpecialtyReport(svc, query(patch), await svc.accounts.list()));
async function postZero(lines: VoucherLineInput[]) {
  const voucher = await book.svc.vouchers.create({
    voucherTypeId: (await book.svc.reference.voucherTypes())[0]!.id,
    date: '2026-01-20',
    lines,
  });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
}

describe('辅助、数量与复币明细账', () => {
  it('w_zc_slz_sl：包含没有数据的科目时生成完整零数量账页，默认仍不列零账页', async () => {
    expect((await report()).rows).toEqual([]);
    const result = await report({ includeZero: true });
    expect(result.entryCount).toBe(0);
    expect(result.rows.map((r) => r.kind)).toEqual(['opening', 'month', 'ytd', 'closing']);
    expect(result.rows.every((r) => r.signedBalance === 0 && r.values?.qtyBalance === '0')).toBe(
      true,
    );
  });

  it('w_zc_fhslz：空辅助账页只使用筛选对象或未指定身份，不假造其他辅助对象', async () => {
    const partner = (await book.svc.dimensions.getByCode('partner', 'C001'))!;
    const all = await report({ kind: 'auxiliary', account: '1122', includeZero: true });
    expect(all.rows.filter((r) => r.kind === 'opening')).toHaveLength(1);
    expect(all.rows.every((r) => r.dimensions === '客户/供应商：未指定')).toBe(true);
    const one = await report({
      kind: 'auxiliary',
      account: '1122',
      includeZero: true,
      dimensions: { partner: partner.id },
    });
    expect(one.rows.filter((r) => r.kind === 'opening')).toHaveLength(1);
    expect(
      one.rows.every((r) => r.dimensions.includes('C001') && !r.dimensions.includes('未指定')),
    ).toBe(true);
    expect(one.rows.every((r) => r.sectionKey?.includes(`|${partner.id}|`))).toBe(true);
  });

  it('w_zc_fhslz：各辅助对象独立期初、逐笔余额，筛选后不混入其他对象', async () => {
    const { partnerId } = await seedLedgerBook(book.svc);
    const all = await report({
      kind: 'auxiliary',
      periodFrom: 202602,
      periodTo: 202602,
      account: '1122',
    });
    expect(all.entryCount).toBe(2);
    const closings = all.rows.filter((r) => r.kind === 'closing');
    expect(closings.map((r) => r.signedBalance)).toEqual([1300, 200]);
    expect(new Set(closings.map((r) => r.sectionKey)).size).toBe(2);
    expect(closings.map((r) => r.dimensions)).toEqual(
      expect.arrayContaining([expect.stringContaining('C001'), expect.stringContaining('S001')]),
    );
    const one = await report({
      kind: 'auxiliary',
      periodFrom: 202602,
      periodTo: 202602,
      account: '1122',
      dimensions: { partner: partnerId },
    });
    expect(one.entryCount).toBe(1);
    expect(one.rows[0]).toMatchObject({ kind: 'opening', signedBalance: 500 });
    expect(one.rows.at(-1)).toMatchObject({ signedBalance: 1300 });
    expect(one.rows.find((r) => r.kind === 'entry')?.href).toContain('/m/voucher-entry/edit?id=');
  });

  it('w_zc_fhslz：未指定辅助项独立显示，不能静默并入已有项目', async () => {
    await seedVouchers(book.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '6601', debit: 100, dims: { department: '01' } },
          { account: '6601', debit: 200 },
          { account: '4001', credit: 300 },
        ],
      },
    ]);
    const result = await report({
      kind: 'auxiliary',
      account: '6601',
      dimensionType: 'department',
    });
    const closings = result.rows.filter((r) => r.kind === 'closing');
    expect(closings).toHaveLength(2);
    expect(closings[0]).toMatchObject({ dimensions: '部门：未指定', signedBalance: 200 });
    expect(closings[1]?.dimensions).toContain('01');
    expect(closings[1]?.signedBalance).toBe(100);
  });

  it('w_zc_slz_fb：本位币与原币同时结余，红字保留原侧，零本币分录仍计原币', async () => {
    const usd = await book.svc.accounts.require('100202');
    await book.svc.opening.upsert({
      year: 2026,
      accountId: usd.id,
      currency: 'USD',
      balance: 71000,
      fcBalance: 10000,
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '100202', debit: 7100, currency: 'USD', rate: '7.1', fcAmount: 1000 },
          { account: '4001', credit: 7100 },
        ],
      },
      {
        date: '2026-01-04',
        status: 'posted',
        lines: [
          { account: '100202', credit: 1420, currency: 'USD', rate: '7.1', fcAmount: 200 },
          { account: '4001', debit: 1420 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '100202', credit: -710, currency: 'USD', rate: '7.1', fcAmount: -100 },
          { account: '4001', debit: -710 },
        ],
      },
    ]);
    await postZero([
      {
        accountId: usd.id,
        summary: '零本币外币借方',
        debit: 0,
        credit: 0,
        entrySide: 'debit',
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 4,
      },
      {
        accountId: usd.id,
        summary: '零本币外币贷方',
        debit: 0,
        credit: 0,
        entrySide: 'credit',
        currency: 'USD',
        exchangeRate: '7.1',
        fcAmount: 3,
      },
    ]);
    const result = await report({ kind: 'foreign', account: '100202', currency: 'USD' });
    const entries = result.rows.filter((r) => r.kind === 'entry');
    expect(entries.map((r) => r.values?.fcSignedBalance)).toEqual([
      11000, 10800, 10900, 10904, 10901,
    ]);
    expect(entries[2]?.values).toMatchObject({ fcDebit: 0, fcCredit: -100 });
    expect(result.rows.at(-1)).toMatchObject({
      signedBalance: 77390,
      values: { fcBalance: 10901, fcSide: '借' },
    });
    expect(result.rows.find((r) => r.kind === 'month')?.values).toMatchObject({
      fcDebit: 1004,
      fcCredit: 103,
    });
    const nextMonth = await report({
      kind: 'foreign',
      account: '100202',
      currency: 'USD',
      periodFrom: 202602,
      periodTo: 202602,
    });
    expect(nextMonth.entryCount).toBe(0);
    expect(nextMonth.rows[0]?.values?.fcBalance).toBe(10901);
    expect(nextMonth.rows.find((r) => r.kind === 'ytd')?.values).toMatchObject({
      fcDebit: 1004,
      fcCredit: 103,
    });
  });

  it('w_zc_slz_sl：数量精确到百万分之一，红字贷方与零本币数量均按原侧累计', async () => {
    const material = await book.svc.accounts.require('1403');
    await book.svc.opening.upsert({
      year: 2026,
      accountId: material.id,
      balance: 10000,
      quantity: '10.000001',
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '1403', debit: 12345, quantity: '1.234567', unitPrice: '100.00001' },
          { account: '4001', credit: 12345 },
        ],
      },
      {
        date: '2026-01-04',
        status: 'posted',
        lines: [
          { account: '1403', credit: -345, quantity: '-0.000001', unitPrice: '3450000' },
          { account: '4001', debit: -345 },
        ],
      },
    ]);
    await postZero([
      {
        accountId: material.id,
        summary: '数量借方',
        debit: 0,
        credit: 0,
        entrySide: 'debit',
        quantity: '0.000001',
      },
      {
        accountId: material.id,
        summary: '数量贷方',
        debit: 0,
        credit: 0,
        entrySide: 'credit',
        quantity: '0.000002',
      },
    ]);
    const result = await report();
    expect(
      result.rows.filter((r) => r.kind === 'entry').map((r) => r.values?.qtySignedBalance),
    ).toEqual(['11.234568', '11.234569', '11.23457', '11.234568']);
    expect(result.rows.find((r) => r.kind === 'month')?.values).toMatchObject({
      qtyDebit: '1.234568',
      qtyCredit: '0.000001',
      quantityUnit: '千克',
    });
    expect(result.rows.find((r) => r.kind === 'entry')?.values?.unitPrice).toBe('100.00001');
    const expectedUnitPrice = new Decimal(22690)
      .div(100)
      .div('11.234568')
      .toDecimalPlaces(6)
      .toFixed();
    expect(result.rows.at(-1)).toMatchObject({
      signedBalance: 22690,
      values: { qtyBalance: '11.234568', qtySide: '借', balanceUnitPrice: expectedUnitPrice },
    });
  });

  it('w_zc_slz_sl：不同单位按科目成账，不能产生混合数量合计', async () => {
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '1403', debit: 100, quantity: '1.1' },
          { account: '1405', debit: 200, quantity: '2.2' },
          { account: '4001', credit: 300 },
        ],
      },
    ]);
    const result = await report({ account: '' });
    expect(
      result.rows
        .filter((r) => r.kind === 'closing')
        .map((r) => [r.values?.quantityUnit, r.values?.qtyBalance]),
    ).toEqual([
      ['千克', '1.1'],
      ['件', '2.2'],
    ]);
    expect(
      new Set(result.rows.filter((r) => r.kind === 'closing').map((r) => r.sectionKey)).size,
    ).toBe(2);
  });

  it('w_zc_slz_slfb/w_zc_fzslz_fb：辅助数量复币同时分对象、分单位并保留本币与原币', async () => {
    const account = await book.svc.accounts.create(
      {
        code: '160101',
        name: '辅助外币数量',
        currency: 'USD',
        quantityUnit: '台',
        dimensions: [{ type: 'department' }],
      },
      [4, 2, 2],
    );
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          {
            account: account.code,
            debit: 7100,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 1000,
            quantity: '1.25',
            unitPrice: '56.8',
            dims: { department: '01' },
          },
          {
            account: account.code,
            debit: 14200,
            currency: 'USD',
            rate: '7.1',
            fcAmount: 2000,
            quantity: '2.5',
            unitPrice: '56.8',
            dims: { department: '02' },
          },
          { account: '4001', credit: 21300 },
        ],
      },
    ]);
    const result = await report({
      kind: 'auxiliary',
      valueMode: 'quantity-foreign',
      account: account.code,
      currency: 'USD',
      dimensionType: 'department',
    });
    expect(result.title).toBe('辅助数量复币明细账');
    expect(result.rows.filter((r) => r.kind === 'closing').map((r) => r.values)).toEqual([
      expect.objectContaining({
        fcBalance: 1000,
        qtyBalance: '1.25',
        quantityUnit: '台',
        balanceUnitPrice: '56.8',
      }),
      expect.objectContaining({
        fcBalance: 2000,
        qtyBalance: '2.5',
        quantityUnit: '台',
        balanceUnitPrice: '56.8',
      }),
    ]);
    const expanded = await report({
      kind: 'quantity-foreign',
      account: account.code,
      currency: 'USD',
      dimensionType: 'department',
      groupAuxiliary: true,
    });
    expect(expanded.rows.filter((r) => r.kind === 'closing')).toHaveLength(2);
  });

  it('w_zc_slz_sl/w_zc_slz_fb：非数量/非复币科目及未选外币时明确拒绝', async () => {
    await expect(report({ account: '1001' })).rejects.toThrow(/数量核算/);
    await expect(report({ kind: 'foreign', account: '1001', currency: 'USD' })).rejects.toThrow(
      /USD外币核算/,
    );
    await expect(report({ kind: 'foreign', account: '100202' })).rejects.toThrow(/选择一个外币/);
    await expect(report({ kind: 'foreign', account: '100202', currency: 'CNY' })).rejects.toThrow(
      /选择一个外币/,
    );
    await expect(report({ kind: 'auxiliary', account: '1403' })).rejects.toThrow(/辅助核算/);
  });

  it.each(['cash', 'bank'] as const)(
    'w_zc_xjrjz_fb/w_zc_yhrjz_fb：%s复币日记账保留本日小计，零本币原币照常收付',
    async (kind) => {
      const account =
        kind === 'cash'
          ? await book.svc.accounts.create(
              { code: '100101', name: '美元现金', isCash: true, currency: 'USD' },
              [4, 2, 2],
            )
          : await book.svc.accounts.require('100202');
      await book.svc.opening.upsert({
        year: 2026,
        accountId: account.id,
        currency: 'USD',
        balance: 71000,
        fcBalance: 10000,
      });
      await seedVouchers(book.svc, [
        {
          date: '2026-01-03',
          status: 'posted',
          lines: [
            { account: account.code, debit: 7100, currency: 'USD', rate: '7.1', fcAmount: 1000 },
            { account: '4001', credit: 7100 },
          ],
        },
        {
          date: '2026-01-03',
          status: 'posted',
          lines: [
            { account: account.code, credit: 1420, currency: 'USD', rate: '7.1', fcAmount: 200 },
            { account: '4001', debit: 1420 },
          ],
        },
        {
          date: '2026-01-04',
          status: 'posted',
          lines: [
            { account: account.code, debit: 710, currency: 'USD', rate: '7.1', fcAmount: 100 },
            { account: '4001', credit: 710 },
          ],
        },
      ]);
      await postZero([
        {
          accountId: account.id,
          summary: '零本币原币收入',
          debit: 0,
          credit: 0,
          entrySide: 'debit',
          currency: 'USD',
          exchangeRate: '7.1',
          fcAmount: 4,
        },
        {
          accountId: account.id,
          summary: '零本币原币付出',
          debit: 0,
          credit: 0,
          entrySide: 'credit',
          currency: 'USD',
          exchangeRate: '7.1',
          fcAmount: 3,
        },
      ]);
      const result = await report({
        kind,
        valueMode: 'foreign',
        account: account.code,
        currency: 'USD',
      });
      expect(result.title).toBe(kind === 'cash' ? '现金复币日记账' : '银行复币日记账');
      expect(
        result.rows
          .filter((r) => r.kind === 'day')
          .map((r) => ({
            date: r.date,
            debit: r.debit,
            credit: r.credit,
            fcDebit: r.values?.fcDebit,
            fcCredit: r.values?.fcCredit,
            fcBalance: r.values?.fcBalance,
          })),
      ).toEqual([
        {
          date: '2026-01-03',
          debit: 7100,
          credit: 1420,
          fcDebit: 1000,
          fcCredit: 200,
          fcBalance: 10800,
        },
        { date: '2026-01-04', debit: 710, credit: 0, fcDebit: 100, fcCredit: 0, fcBalance: 10900 },
        { date: '2026-01-20', debit: 0, credit: 0, fcDebit: 4, fcCredit: 3, fcBalance: 10901 },
      ]);
      expect(result.rows.at(-1)).toMatchObject({
        signedBalance: 77390,
        values: { fcBalance: 10901 },
      });
      await expect(
        report({
          kind: kind === 'cash' ? 'bank' : 'cash',
          valueMode: 'foreign',
          account: account.code,
          currency: 'USD',
        }),
      ).rejects.toThrow(/标志/);
    },
  );

  it('w_zc_xjrjz_1：本位币日记账可按现金流量辅助展开，未指定对象保留独立账页', async () => {
    await seedLedgerBook(book.svc);
    const result = await report({
      kind: 'cash',
      valueMode: 'base',
      account: '1001',
      dimensionType: 'cashflow',
      groupAuxiliary: true,
      periodFrom: 202602,
      periodTo: 202602,
    });
    expect(result.title).toBe('现金日记账');
    expect(result.rows.filter((r) => r.kind === 'closing')).toHaveLength(1);
    expect(result.rows.at(-1)).toMatchObject({ signedBalance: 61600 });
    expect(result.rows.at(-1)?.dimensions).toContain('未指定');
    expect(result.rows.filter((r) => r.kind === 'day')).toHaveLength(3);
  });

  it('w_zc_slz_fb/_sl：年中启用的原币/数量累计留空并说明，跨年重新累计', async () => {
    await book.close();
    book = await createTestBook({ startMonth: 7 });
    const usd = await book.svc.accounts.require('100202');
    await book.svc.opening.upsert({
      year: 2026,
      accountId: usd.id,
      currency: 'USD',
      balance: 710,
      fcBalance: 100,
      ytdDebit: 7000,
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-07-05',
        status: 'posted',
        lines: [
          { account: '100202', debit: 71, currency: 'USD', rate: '7.1', fcAmount: 10 },
          { account: '4001', credit: 71 },
        ],
      },
    ]);
    const result = await report({
      kind: 'foreign',
      account: '100202',
      currency: 'USD',
      periodFrom: 202607,
      periodTo: 202607,
    });
    const ytd = result.rows.find((r) => r.kind === 'ytd')!;
    expect(ytd.debit).toBe(7071);
    expect(ytd.values?.fcDebit).toBeNull();
    expect(ytd.values?.fcCredit).toBeNull();
    expect(ytd.values?.dimensionYtdMissing).toContain('不能按零计算');
    const material = await book.svc.accounts.require('1403');
    await book.svc.opening.upsert({
      year: 2026,
      accountId: material.id,
      balance: 100,
      quantity: '2',
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-07-06',
        status: 'posted',
        lines: [
          { account: '1403', debit: 10, quantity: '0.5' },
          { account: '4001', credit: 10 },
        ],
      },
    ]);
    const quantity = await report({ periodFrom: 202607, periodTo: 202607 });
    const quantityYtd = quantity.rows.find((r) => r.kind === 'ytd')!;
    expect(quantityYtd.values?.qtyDebit).toBeNull();
    expect(quantityYtd.values?.qtyCredit).toBeNull();
    expect(quantityYtd.values?.dimensionYtdMissing).toContain('不能按零计算');
    await book.svc.periods.ensureYear(2027);
    const next = await report({
      kind: 'foreign',
      account: '100202',
      currency: 'USD',
      periodFrom: 202701,
      periodTo: 202701,
    });
    expect(next.rows[0]?.values?.fcBalance).toBe(110);
    expect(next.rows.find((r) => r.kind === 'ytd')?.values).toMatchObject({
      fcDebit: 0,
      fcCredit: 0,
      dimensionYtdMissing: null,
    });
  });

  it('w_zc_slz_sl：随机百万分之一数量累计等于精确十进制和', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 999999 }), { minLength: 1, maxLength: 6 }),
        async (increments) => {
          const isolated = await createTestBook();
          try {
            await seedVouchers(
              isolated.svc,
              increments.map((n, i) => ({
                date: `2026-01-${String(i + 1).padStart(2, '0')}`,
                status: 'posted' as const,
                lines: [
                  { account: '1403', debit: 1, quantity: new Decimal(n).div(1_000_000).toFixed() },
                  { account: '4001', credit: 1 },
                ],
              })),
            );
            const result = await isolated
              .forModule('ledgers')
              .tx(async (svc) => buildSpecialtyReport(svc, query(), await svc.accounts.list()));
            const expected = increments.reduce(
              (sum, n) => sum.plus(new Decimal(n).div(1_000_000)),
              new Decimal(0),
            );
            expect(result.rows.at(-1)?.values?.qtyBalance).toBe(expected.toFixed());
          } finally {
            await isolated.close();
          }
        },
      ),
      { numRuns: 6 },
    );
  });
});
