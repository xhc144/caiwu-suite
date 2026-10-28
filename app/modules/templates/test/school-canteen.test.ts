import { expect, it } from 'vitest';
import { mapTemplateScheme, parseCodeScheme, parseTemplate, templateProblems } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import manifest from '../manifest';
import raw from '../templates/school-canteen-anhui-2021.json' with { type: 'json' };

const template = parseTemplate(raw);
const server = defineServerModule(manifest, {
  router: moduleKit(manifest).router({}),
  templates: [raw],
});
const setup = () => createTestApp({ modules: [server], templateId: template.id, seed: false });

// 独立录自皖教秘〔2021〕215号第二部分科目表，不从被测模板生成期望集合。
const primary = [
  ['1001', '库存现金', 'asset', 'debit'],
  ['1002', '银行存款', 'asset', 'debit'],
  ['1218', '其他应收款', 'asset', 'debit'],
  ['1302', '库存物品', 'asset', 'debit'],
  ['1902', '待处置财产损溢', 'asset', 'debit'],
  ['2302', '应付账款', 'liability', 'credit'],
  ['2305', '预收伙食费', 'liability', 'credit'],
  ['2307', '其他应付款', 'liability', 'credit'],
  ['3001', '累计盈余', 'net-assets', 'credit'],
  ['3301', '本期盈余', 'net-assets', 'credit'],
  ['4201', '上级补助收入', 'revenue', 'credit'],
  ['4401', '伙食收入', 'revenue', 'credit'],
  ['4609', '其他收入', 'revenue', 'credit'],
  ['5201', '伙食费用', 'expense', 'debit'],
  ['5901', '其他费用', 'expense', 'debit'],
];
const tableDetails = [
  ['300101', '营养餐累计盈余'],
  ['300102', '非营养餐累计盈余'],
  ['330101', '营养餐本期盈余'],
  ['330102', '非营养餐本期盈余'],
  ['440101', '营养餐收入'],
  ['440102', '非营养餐收入'],
  ['520101', '营养餐费用'],
  ['520102', '非营养餐费用'],
];
const expenseNames = [
  '粮食',
  '食用油',
  '蔬菜',
  '肉（豆）制品',
  '水产品',
  '蛋奶类',
  '调料',
  '人工费',
  '水电费',
  '燃料费',
  '低值易耗品',
  '其他',
];

it('w_xt_kgzb_a2：安徽食堂原文15项一级与8项二级完整，适用地区及年度明确', () => {
  expect(templateProblems(template)).toEqual([]);
  expect(
    template.accounts
      .filter((a) => a.code.length === 4)
      .map((a) => [a.code, a.name, a.category, a.direction]),
  ).toEqual(primary);
  for (const [code, name] of tableDetails) {
    expect(template.accounts.find((a) => a.code === code)?.name).toBe(name);
  }
  expect(template.accounts).toHaveLength(60);
  expect(template.name).toContain('安徽');
  expect(template.description).toContain('2021年1月1日');
  expect(template.description).toContain('批准实施学生营养改善计划');
  expect(template.accounts.some((a) => a.name === '固定资产')).toBe(false);
  expect(template.accounts.find((a) => a.code === '1902')?.balanceNature).toBe('both');
  expect(template.reports).toEqual([]);
  expect(template.accounts.filter((a) => a.cash).map((a) => a.code)).toEqual(['1001']);
  expect(template.accounts.filter((a) => a.bank).map((a) => a.code)).toEqual(['1002']);
  for (const a of template.accounts) {
    expect(a.needsReview).toBe(false);
    expect(a.source).toContain('皖教秘〔2021〕215号');
    expect(a.source).toContain(a.code);
    expect(a.source).toContain(a.name);
    expect(a.source).toContain('ahhuoshan.gov.cn');
  }
});

it('w_xt_kgzb_a2：营养与非营养分类分开，营养餐不预设四项禁止使用的费用', () => {
  const expenseChildren = (parent: string) =>
    template.accounts
      .filter((a) => a.code.length === 8 && a.code.startsWith(parent))
      .map((a) => a.name);
  expect(expenseChildren('520102')).toEqual(expenseNames);
  expect(expenseChildren('520101')).toEqual([
    '粮食',
    '食用油',
    '蔬菜',
    '肉（豆）制品',
    '水产品',
    '蛋奶类',
    '调料',
    '其他',
  ]);
  expect(
    template.accounts
      .filter((a) => a.code.length === 8 && a.code.startsWith('440101'))
      .map((a) => [a.code, a.name]),
  ).toEqual([
    ['44010101', '学生餐费'],
    ['44010102', '陪餐餐费'],
    ['44010103', '教职工就餐费'],
  ]);
  expect(
    template.accounts
      .filter((a) => a.code.length === 6 && a.code.startsWith('1302'))
      .map((a) => a.name),
  ).toEqual([
    '粮食',
    '食用油',
    '蔬菜',
    '肉（豆）制品',
    '水产品',
    '蛋奶类',
    '调料',
    '燃料',
    '其他材料',
  ]);
  for (const code of ['130201', '44010101', '52010112', '121801', '230701']) {
    expect(template.accounts.find((a) => a.code === code)?.source).toContain('应用默认编码');
  }
  for (const [code] of tableDetails) {
    expect(template.accounts.find((a) => a.code === code)?.source).not.toContain('应用默认编码');
  }
});

it('w_xt_kgzb_3：4-3-3真实建账映射二三级父链，持久化且不串账', async () => {
  const app = await setup();
  try {
    const native = await app.svc.accounts.list();
    const book = await app.core().books.create({
      name: '安徽食堂三级编码',
      orgName: '合成学校',
      templateId: template.id,
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'admin',
      codeScheme: '4-3-3',
    });
    const { token } = await app.core(null).auth.login({
      bookId: book.id,
      userCode: 'admin',
      password: 'admin',
    });
    const rows = await app.core(token).accounts.list();
    expect(rows).toHaveLength(60);
    const parent = rows.find((a) => a.code === '5201001')!;
    expect(rows.find((a) => a.code === '5201001001')).toMatchObject({
      name: '粮食',
      level: 3,
      parentId: parent.id,
      isLeaf: true,
      categoryId: 'expense',
    });
    const mapped = mapTemplateScheme(template, parseCodeScheme('4-3-3'));
    expect(rows.map((a) => [a.code, a.name])).toEqual(mapped.accounts.map((a) => [a.code, a.name]));
    await app.runtime.bookStore.close(book.id);
    app.runtime.bookStore.open(book.id);
    expect(await app.core(token).accounts.list()).toEqual(rows);
    expect(await app.svc.accounts.list()).toEqual(native);
    await expect(app.core(null).accounts.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_3：营养餐拨款、材料领用、月末及年度明细结转可正式过账，缺对象和非末级拒绝', async () => {
  const app = await setup();
  try {
    await app.svc.dimensions.create({ type: 'partner', code: 'SCHOOL', name: '合成学校拨款方' });
    const missingParty = await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1002', debit: 100_00 },
        { account: '230701', credit: 100_00 },
      ],
    });
    await expect(app.svc.vouchers.create(missingParty)).rejects.toMatchObject({
      data: { code: 'VOUCHER_INVALID' },
    });
    const parentAccount = await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '520101', debit: 40_00 },
        { account: '1002', credit: 40_00 },
      ],
    });
    await expect(app.svc.vouchers.create(parentAccount)).rejects.toMatchObject({
      data: { code: 'VOUCHER_INVALID' },
    });
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1002', debit: 100_00 },
          { account: '230701', credit: 100_00, dims: { partner: 'SCHOOL' } },
        ],
      },
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '230701', debit: 100_00, dims: { partner: 'SCHOOL' } },
          { account: '44010101', credit: 100_00 },
        ],
      },
      {
        date: '2026-01-07',
        status: 'posted',
        lines: [
          { account: '130201', debit: 40_00 },
          { account: '1002', credit: 40_00 },
        ],
      },
      {
        date: '2026-01-08',
        status: 'posted',
        lines: [
          { account: '52010101', debit: 40_00 },
          { account: '130201', credit: 40_00 },
        ],
      },
      {
        date: '2026-01-31',
        status: 'posted',
        lines: [
          { account: '44010101', debit: 100_00 },
          { account: '330101', credit: 100_00 },
        ],
      },
      {
        date: '2026-01-31',
        status: 'posted',
        lines: [
          { account: '330101', debit: 40_00 },
          { account: '52010101', credit: 40_00 },
        ],
      },
    ]);
    const rows = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      includeZero: true,
    });
    const closing = (code: string) => rows.find((r) => r.accountCode === code)?.closing;
    expect(closing('1002')).toBe(60_00);
    expect(closing('3301')).toBe(-60_00);
    expect(closing('330101')).toBe(-60_00);
    expect(closing('330102')).toBe(0);
    for (const code of ['130201', '230701', '44010101', '52010101']) expect(closing(code)).toBe(0);
    expect((await app.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    await seedVouchers(app.svc, [
      {
        date: '2026-12-31',
        status: 'posted',
        lines: [
          { account: '330101', debit: 60_00 },
          { account: '300101', credit: 60_00 },
        ],
      },
    ]);
    const annual = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202612,
      includeZero: true,
    });
    for (const code of ['3301', '330101', '330102'])
      expect(annual.find((row) => row.accountCode === code)?.closing).toBe(0);
    expect(annual.find((row) => row.accountCode === '300101')?.closing).toBe(-60_00);
    expect(annual.find((row) => row.accountCode === '300102')?.closing).toBe(0);
    expect((await app.svc.ledger.trialBalance(202601, 202612)).balanced).toBe(true);
  } finally {
    await app.close();
  }
});
