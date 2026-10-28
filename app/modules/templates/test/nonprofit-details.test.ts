import { describe, expect, it } from 'vitest';
import {
  mapTemplateScheme,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  templateProblems,
} from '@caiwu/core';
import { createTestBook, voucherInputFromSpec } from '@caiwu/testkit';
import nonprofit from '../templates/nonprofit-2026.json' with { type: 'json' };

const template = parseTemplate(nonprofit);

// 独立按原文列出的名称、分类和物理页抄录；明细编号是应用选择，非财政部规定编号。
const fixedDetails: [string, number, string][] = [
  [
    '1009',
    59,
    '01外埠存款 02银行汇票 03银行本票 04信用卡存款 05信用证保证金存款 06存出投资款 07非银行支付机构网络支付款',
  ],
  ['1101', 59, '01委托贷款 02委托投资 99其他短期投资'],
  ['1402', 75, '01债券投资 02可转换公司债券 03其他债权投资'],
  ['140201', 75, '01面值 02溢价或折价 03债券费用 04应收利息'],
  ['2204', 97, '01职工工资 02职工福利费 03津贴补贴 04奖金 05社会保险费 06住房公积金'],
  ['2206', 98, '01应交增值税 02城市维护建设税 03教育费附加 04企业所得税 05房产税 06个人所得税'],
  ['3201', 106, '01非限定性净资产 02限定性净资产'],
];
const revenueDetails: [string, number][] = [
  ['4101', 107],
  ['4201', 109],
  ['4301', 110],
  ['4401', 111],
  ['4501', 112],
  ['4601', 114],
  ['4701', 117],
  ['4901', 118],
];
const expenseDetails: [string, number][] = [
  ['5101', 119],
  ['5201', 120],
  ['5301', 121],
  ['5401', 123],
  ['5501', 124],
  ['5901', 125],
];

it('w_xt_kgzb_a2：保持56个法定一级科目，62项原文明细及5项应用补充逐项核对', () => {
  expect(template.version).toBe('1.2.0');
  expect(template.accounts.filter((a) => a.code.length === 4)).toHaveLength(56);
  expect(template.accounts).toHaveLength(123);
  const expected: { code: string; name: string; page: number }[] = [];
  for (const [parent, page, entries] of fixedDetails) {
    for (const item of entries.split(' '))
      expected.push({ code: parent + item.slice(0, 2), name: item.slice(2), page });
  }
  for (const [parent, page] of revenueDetails) {
    expected.push({ code: parent + '01', name: '非限定性收入', page });
    expected.push({ code: parent + '02', name: '限定性收入', page });
  }
  for (const [parent, page] of expenseDetails) {
    expected.push({ code: parent + '01', name: '非限定性费用', page });
    expected.push({ code: parent + '02', name: '限定性费用', page });
  }
  for (const [parent, page, name, other] of [
    ['5101', 119, '设立慈善信托支出', '其他业务活动成本'],
    ['5401', 123, '募捐成本', '其他筹资费用'],
  ] as const) {
    for (const restriction of ['01', '02']) {
      expected.push({ code: parent + restriction + '01', name, page });
      expected.push({ code: parent + restriction + '99', name: other, page });
    }
  }
  expect(
    template.accounts.filter((a) => a.code.length > 4).map(({ code, name }) => ({ code, name })),
  ).toEqual(
    expected.map(({ code, name }) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)),
  );
  for (const { code, name, page } of expected) {
    const account = template.accounts.find((a) => a.code === code)!;
    const root = template.accounts.find((a) => a.code === code.slice(0, 4))!;
    expect(account).toMatchObject({
      name,
      category: root.category,
      direction: root.direction,
      dimensions: [],
      disabled: false,
      needsReview: false,
    });
    expect(account.source).toContain(`PDF第${page}页`);
    expect(account.source).toContain(`${code} ${name}`);
    expect(account.source).toContain('应用默认');
    expect(account.sourceVersion).toContain('1.2.0');
  }
  expect(template.accounts.some((a) => a.code.startsWith('5601') && a.code.length > 4)).toBe(false);
  expect(template.accounts.find((a) => a.code === '110101')?.source).toContain(
    '委托贷款且作为短期投资核算时',
  );
  expect(template.accounts.find((a) => a.code === '110102')?.source).toContain(
    '委托投资（包括委托理财）且作为短期投资核算时',
  );
  expect(template.accounts.find((a) => a.code === '110199')?.source).toContain(
    '本项名称和编码均非原文规定',
  );
});

it('w_xt_kgzb_a3：限制性质及专门支出两层分类可映射4-3-3，保持每条父链和余额性质', () => {
  const target = parseCodeScheme('4-3-3');
  const mapped = mapTemplateScheme(template, target);
  expect(templateProblems(mapped, target)).toEqual([]);
  for (const account of mapped.accounts) {
    const parent = parentCodeOf(account.code, target);
    if (parent) expect(mapped.accounts.some((a) => a.code === parent)).toBe(true);
  }
  expect(mapped.accounts.find((a) => a.code === '5101002001')).toMatchObject({
    name: '设立慈善信托支出',
    category: 'expense',
    direction: 'debit',
    balanceNature: 'no-closing-balance',
  });
  expect(mapped.accounts.find((a) => a.code === '3201002')).toMatchObject({
    name: '限定性净资产',
    balanceNature: 'no-closing-balance',
  });
  expect(template.accounts.find((a) => a.code === '14020102')?.balanceNature).toBe('both');
  for (const code of ['1102', '1131', '1202', '1421', '1502', '1602'])
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      isContra: true,
      direction: 'credit',
    });
});

it('w_xt_kgzb_a2：增值税明确采用小规模默认，不把一般纳税人专栏强制给全部组织', () => {
  expect(template.description).toContain('增值税默认小规模纳税人');
  expect(template.accounts.filter((a) => a.code.startsWith('220601'))).toHaveLength(1);
  const vat = template.accounts.find((a) => a.code === '220601')!;
  for (const column of ['进项税额', '销项税额', '出口退税', '进项税额转出', '已交税金'])
    expect(vat.source).toContain(column);
  expect(template.description).toContain('不自动修改已有账套');
});

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb_3：民非规定明细 %s', (codeScheme) => {
  it('真实SQLite建账后按限定性末级记账、过账与汇总，非末级不能正式记账', async () => {
    const book = await createTestBook({
      templates: [nonprofit],
      templateId: template.id,
      codeScheme,
      seed: false,
    });
    try {
      const scheme = parseCodeScheme(codeScheme);
      const mapped = mapTemplateScheme(template, scheme);
      const restriction = codeScheme === '4-2-2' ? '02' : '002';
      const special = codeScheme === '4-2-2' ? '01' : '001';
      const incomeCode = '4101' + restriction;
      const expenseCode = '5101' + restriction + special;
      const rows = await book.svc.accounts.list();
      expect(rows).toHaveLength(123);
      for (const code of [incomeCode, expenseCode]) {
        const row = rows.find((a) => a.code === code)!;
        const parent = rows.find((a) => a.code === parentCodeOf(code, scheme))!;
        expect(row).toMatchObject({ parentId: parent.id, isLeaf: true });
      }
      expect(rows.find((a) => a.code === expenseCode)?.fullName).toBe(
        '业务活动成本/限定性费用/设立慈善信托支出',
      );
      expect(mapped.accounts.find((a) => a.code === expenseCode)?.sourceVersion).toContain('1.2.0');
      const income = await voucherInputFromSpec(book.svc, {
        date: '2026-01-05',
        lines: [
          { account: '1002', debit: 123_45 },
          { account: incomeCode, credit: 123_45 },
        ],
      });
      const expense = await voucherInputFromSpec(book.svc, {
        date: '2026-01-06',
        lines: [
          { account: expenseCode, debit: 23_45 },
          { account: '1002', credit: 23_45 },
        ],
      });
      const incomeVoucher = await book.svc.vouchers.create(income);
      const expenseVoucher = await book.svc.vouchers.create(expense);
      await book.svc.vouchers.changeStatus({
        ids: [incomeVoucher.id, expenseVoucher.id],
        to: 'audited',
      });
      await book.svc.vouchers.changeStatus({
        ids: [incomeVoucher.id, expenseVoucher.id],
        to: 'posted',
      });
      const balances = await book.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
      expect(balances.find((a) => a.accountCode === '4101')?.closing).toBe(-123_45);
      expect(balances.find((a) => a.accountCode === '5101')?.closing).toBe(23_45);
      expect(balances.find((a) => a.accountCode === expenseCode)?.closing).toBe(23_45);
      expect(balances.find((a) => a.accountCode === '1002')?.closing).toBe(100_00);
      const investmentSuffix = codeScheme === '4-2-2' ? ['01', '02', '99'] : ['001', '002', '099'];
      const investments = await voucherInputFromSpec(book.svc, {
        date: '2026-01-06',
        lines: [
          { account: '1101' + investmentSuffix[0], debit: 111 },
          { account: '1101' + investmentSuffix[1], debit: 222 },
          { account: '1101' + investmentSuffix[2], debit: 333 },
          { account: '1002', credit: 666 },
        ],
      });
      await book.svc.vouchers.create(investments);
      const investmentBalances = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['1101'],
        includeUnposted: true,
      });
      expect(investmentBalances.find((a) => a.accountCode === '1101')?.closing).toBe(666);
      expect(investmentBalances.filter((a) => a.isLeaf).map((a) => a.closing)).toEqual([
        111, 222, 333,
      ]);
      const bad = await voucherInputFromSpec(book.svc, {
        date: '2026-01-07',
        lines: [
          { account: '1002', debit: 1 },
          { account: '4101', credit: 1 },
        ],
      });
      await expect(book.svc.vouchers.create(bad)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      expect((await book.svc.vouchers.list({})).total).toBe(3);
      await book.svc.periods.setStatus(202601, 'closed');
      await expect(book.svc.vouchers.create(income)).rejects.toThrow(/结账/);
      expect((await book.svc.vouchers.list({})).total).toBe(3);
    } finally {
      await book.close();
    }
  });
});
