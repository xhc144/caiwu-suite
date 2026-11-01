import { afterEach, describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { parseCodeScheme } from '@caiwu/core';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';
import {
  evaluateFormula,
  formulaRequestKey,
  inspectFormula,
  parseFormula,
  scaleResultValue,
  scaledValue,
  type FormulaAccountRequest,
} from '../server/formula';
import { resolveFormulaAccounts, validateFormulaAccounts } from '../server/formula-accounts';

let book: TestBook | undefined;
afterEach(async () => {
  await book?.close();
  book = undefined;
});
const requests = (formula: string): FormulaAccountRequest[] => {
  const found: FormulaAccountRequest[] = [];
  inspectFormula(
    parseFormula(formula),
    (_fn, _code, request) => found.push(request),
    () => {},
  );
  return found;
};
const value = async (
  formula: string,
  period = 202602,
  scope: 'operating' | 'ledger' = 'ledger',
) => {
  const node = parseFormula(formula);
  return book!.svc.tx(async (svc) => {
    const values = await resolveFormulaAccounts(svc, requests(formula), {
      period,
      scope,
      includeUnposted: false,
    });
    return evaluateFormula(
      node,
      (_fn, _code, request) => values.get(formulaRequestKey(request))!,
      () => new Decimal(0),
    );
  });
};

describe('w_bb_help / w_bb_def_help 的 S/W/F 前缀与参数', () => {
  it('六位数量显式缩放准确保存，原两位稿接口保留，越界明确拒绝', () => {
    expect(scaleResultValue(new Decimal('1.234567'), 6)).toBe(1234567);
    expect(scaleResultValue(new Decimal('-1.2345675'), 6)).toBe(-1234568);
    expect(scaleResultValue(new Decimal('0.000001'), 6)).toBe(1);
    expect(scaledValue(new Decimal('1.234567'))).toBe(123);
    expect(scaleResultValue(new Decimal('9007199254.740991'), 6)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => scaleResultValue(new Decimal('9007199254.740992'), 6)).toThrow('超出');
  });
  it('按资料中的数量、外币及1项目/2客户/3部门/4个人解析，分别保留参数', () => {
    expect(requests('S借方("1403")+W余额("100202","USD")+F累计贷方("1122",2,"C001")')).toEqual([
      { fn: '借方', code: '1403', valueKind: 'quantity' },
      { fn: '余额', code: '100202', valueKind: 'foreign', currency: 'USD' },
      {
        fn: '累计贷方',
        code: '1122',
        valueKind: 'money',
        dimension: { type: 'partner', code: 'C001' },
      },
    ]);
    expect(
      requests('F借方("6601",1,"XM01")+F借方("6601",3,"01")+F借方("6601",4,"P01")').map(
        (r) => r.dimension?.type,
      ),
    ).toEqual(['project', 'department', 'person']);
  });
  it.each([
    'W借方("100202")',
    'W借方("100202",USD)',
    'F借方("1122",0,"C001")',
    'F借方("1122",5,"C001")',
    'F借方("1122",21,"C001")',
    'F借方("1122",2)',
    'S借方("1403","千克")',
    'SW借方("1403","USD")',
    'QCYE("1001")',
    'Sconstructor("x")',
    'W余额("100202","USD");process.exit()',
  ])('参数或无依据基本别名拒绝：%s', (formula) => {
    expect(() => parseFormula(formula)).toThrow();
  });
  it('币种和辅助参数属于请求键，不会混用同科目的取数缓存', () => {
    const r = requests('F借方("1122",2,"C001")+F借方("1122",2,"S001")+借方("1122")');
    expect(new Set(r.map(formulaRequestKey)).size).toBe(3);
  });
});

describe('w_fx_demo 科目函数真实账套取数', () => {
  it('七种基本函数在年中启用、真实期初及本年累计下分别取数，不重加期初', async () => {
    book = await createTestBook({ startMonth: 3 });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('1122')).id,
      dimensions: { partner: (await book.svc.dimensions.getByCode('partner', 'C001'))!.id },
      balance: 5000,
      ytdDebit: 12000,
      ytdCredit: 7000,
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-03-10',
        status: 'posted',
        lines: [
          { account: '1122', debit: 2000, dims: { partner: 'C001' } },
          { account: '6001', credit: 2000 },
        ],
      },
      {
        date: '2026-04-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1000 },
          { account: '1122', credit: 1000, dims: { partner: 'C001' } },
        ],
      },
    ]);
    const expected = {
      借方: '0.00',
      贷方: '10.00',
      余额: '60.00',
      期初: '70.00',
      年初: '50.00',
      累计借方: '140.00',
      累计贷方: '80.00',
    };
    for (const [fn, amount] of Object.entries(expected)) {
      expect((await value(`${fn}("1122")`, 202604, 'ledger')).toFixed(2)).toBe(amount);
      expect((await value(`${fn}("1122")`, 202604, 'operating')).toFixed(2)).toBe(amount);
    }
  });
  it('本币、外币、数量和辅助实际分录分别读取，数量在公式中保持六位小数', async () => {
    book = await createTestBook();
    await seedVouchers(book.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '1403', debit: 12345, quantity: '1.234567', unitPrice: '100' },
          { account: '4001', credit: 12345 },
        ],
      },
      {
        date: '2026-02-11',
        status: 'posted',
        lines: [
          { account: '100202', debit: 7100, currency: 'USD', fcAmount: 1000, rate: '7.1' },
          { account: '4001', credit: 7100 },
        ],
      },
      {
        date: '2026-02-12',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
      {
        date: '2026-02-13',
        status: 'posted',
        lines: [
          { account: '1122', debit: 2222, dims: { partner: 'S001' } },
          { account: '6001', credit: 2222 },
        ],
      },
    ]);
    expect((await value('S借方("1403")')).toFixed(6)).toBe('1.234567');
    expect((await value('S借方("1403") * 1000000')).toFixed(0)).toBe('1234567');
    expect((await value('W借方("100202","USD")')).toFixed(2)).toBe('10.00');
    expect((await value('借方("100202")')).toFixed(2)).toBe('71.00');
    expect((await value('F借方("1122",2,"C001")')).toFixed(2)).toBe('123.45');
    expect((await value('F借方("1122",2,"S001")')).toFixed(2)).toBe('22.22');
    expect((await value('借方("1122")')).toFixed(2)).toBe('145.67');
  });
  it('经营口径本年余额与期初只排除明确的损益结转，不改账面余额', async () => {
    book = await createTestBook();
    await seedVouchers(book.svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 10000 },
          { account: '6001', credit: 10000 },
        ],
      },
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 2000 },
          { account: '6001', credit: 2000 },
        ],
      },
    ]);
    const closing = await book.svc.vouchers.create({
      ...(await voucherInputFromSpec(book.svc, {
        date: '2026-01-31',
        lines: [
          { account: '6001', debit: 10000 },
          { account: '4103', credit: 10000 },
        ],
      })),
      closingKind: 'pnl',
    });
    await book.svc.vouchers.changeStatus({ ids: [closing.id], to: 'audited' });
    await book.svc.vouchers.changeStatus({ ids: [closing.id], to: 'posted' });
    expect((await value('余额("6001")', 202602, 'ledger')).toFixed(2)).toBe('-20.00');
    expect((await value('余额("6001")', 202602, 'operating')).toFixed(2)).toBe('-120.00');
    expect((await value('期初("6001")', 202602, 'ledger')).toFixed(2)).toBe('0.00');
    expect((await value('期初("6001")', 202602, 'operating')).toFixed(2)).toBe('-100.00');
    expect((await value('累计借方("6001")', 202602, 'operating')).toFixed(2)).toBe('0.00');
    expect((await value('累计贷方("6001")', 202602, 'operating')).toFixed(2)).toBe('120.00');
  });
  it('零本币数量分录使用明确借贷方向，经营口径扣除结转后仍保留精确数量', async () => {
    book = await createTestBook();
    const accountId = (await book.svc.accounts.require('1403')).id;
    const voucher = await book.svc.vouchers.create({
      date: '2026-02-28',
      voucherTypeId: (await book.svc.reference.voucherTypes())[0]!.id,
      closingKind: 'pnl',
      lines: [
        {
          accountId,
          summary: '合成数量借方',
          debit: 0,
          credit: 0,
          entrySide: 'debit',
          quantity: '0.000001',
        },
        {
          accountId,
          summary: '合成数量贷方',
          debit: 0,
          credit: 0,
          entrySide: 'credit',
          quantity: '0.000002',
        },
      ],
    });
    await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
    await book.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    expect((await value('S借方("1403")')).toFixed(6)).toBe('0.000001');
    expect((await value('S贷方("1403")')).toFixed(6)).toBe('0.000002');
    expect((await value('S余额("1403")')).toFixed(6)).toBe('-0.000001');
    expect((await value('S借方("1403")', 202602, 'operating')).toFixed(6)).toBe('0.000000');
    expect((await value('S贷方("1403")', 202602, 'operating')).toFixed(6)).toBe('0.000000');
    expect((await value('S余额("1403")', 202602, 'operating')).toFixed(6)).toBe('0.000000');
  });
  it('未提供的启用前外币/数量累计明确拒绝，不能假造历史零值', async () => {
    book = await createTestBook({ startMonth: 2 });
    await expect(value('S累计借方("1403")')).rejects.toThrow('缺少来源');
    await expect(value('W累计贷方("100202","USD")')).rejects.toThrow('缺少来源');
    expect((await value('S借方("1403")')).toString()).toBe('0');
  });
  it('不存在科目、币种、辅助对象以及混合数量单位不能静默当零', async () => {
    book = await createTestBook();
    for (const formula of [
      '余额("9999")',
      'W余额("100202","ZZZ")',
      'W余额("100202","CNY")',
      'F借方("1122",2,"MISSING")',
      'F借方("1001",2,"C001")',
      'S借方("1001")',
    ])
      await expect(validateFormulaAccounts(book.svc, requests(formula))).rejects.toThrow();
    await book.svc.accounts.create(
      { code: '1499', name: '数量父科目', categoryId: 'asset' },
      parseCodeScheme('4-2-2'),
    );
    await book.svc.accounts.create(
      { code: '149901', name: '千克材料', categoryId: 'asset', quantityUnit: '千克' },
      parseCodeScheme('4-2-2'),
    );
    await book.svc.accounts.create(
      { code: '149902', name: '件材料', categoryId: 'asset', quantityUnit: '件' },
      parseCodeScheme('4-2-2'),
    );
    await expect(value('S借方("1499")')).rejects.toThrow('数量单位不同');
  });
});
