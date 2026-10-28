import { describe, expect, it } from 'vitest';
import { mapTemplateScheme, parseCodeScheme, parseTemplate, templateProblems } from '@caiwu/core';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import manifest from '../manifest';
import raw from '../templates/individual-business-1997.json' with { type: 'json' };

const template = parseTemplate(raw);
const kit = moduleKit(manifest);
const fixture = defineServerModule(manifest, { router: kit.router({}), templates: [raw] });

// 独立按财会字〔1997〕19号二（一）1会计科目表抄录，不从被测JSON派生。
const primary = `101现金 102银行存款 111应收款项 121存货 131待摊费用
141待处理财产损失 151固定资产 152累计折旧 153固定资产清理 154在建工程
161无形资产 201借入款项 211应付款项 212应付工资 213应交税金
301业主投资 311本年应税所得 312留存利润 401生产成本 501营业收入
502营业成本 503营业税金 504营业费用 511营业外收支 521税后列支费用`
  .split(/\s+/)
  .map((text) => ({ code: text.slice(0, 3), name: text.slice(3) }));
const detail = [
  ['12101', '材料'],
  ['12102', '商品'],
  ['12103', '产成品'],
  ['12104', '半成品'],
  ['12105', '低值易耗品'],
  ['14101', '待处理存货损失'],
  ['14102', '待处理固定资产损失'],
  ['31101', '本年经营所得'],
  ['31102', '应弥补的亏损'],
];

it('w_xt_kgzb_a2 个体工商户：25项原文一级完整、固定损失明细及存货常用分类可定位', () => {
  expect(templateProblems(template)).toEqual([]);
  expect(
    template.accounts.filter((a) => a.code.length === 3).map(({ code, name }) => ({ code, name })),
  ).toEqual(primary);
  expect(template.accounts.filter((a) => a.code.length > 3).map((a) => [a.code, a.name])).toEqual(
    detail,
  );
  expect(template.accounts).toHaveLength(34);
  for (const account of template.accounts) {
    expect(account.source).toContain('财会字〔1997〕19号');
    expect(account.source).toContain('https://fgk.mof.gov.cn/');
    expect(account.needsReview).toBe(false);
    expect(account.sourceVersion).toBe('财会字〔1997〕19号');
    if (account.code.length > 3) expect(account.source).toContain('应用默认编码');
  }
  expect(template.description).toContain('复式账');
  expect(template.description).toContain('不预设税率');
  expect(template.reports).toEqual([]);
  expect(template.accounts.find((a) => a.code === '152')).toMatchObject({
    category: 'asset',
    direction: 'credit',
    isContra: true,
  });
  expect(template.accounts.find((a) => a.code === '521')).toMatchObject({
    category: 'pnl',
    direction: 'debit',
    closingRule: 'retained-earnings',
  });
  expect(template.accounts.find((a) => a.code === '501')?.closingRule).toBe('profit');
  expect(template.accounts.find((a) => a.code === '111')).toMatchObject({
    balanceNature: 'both',
    partner: true,
    dimensions: [{ type: 'partner', required: true }],
  });
});

describe.each(['3-2-2', '3-3-3'])('w_xt_kgzb_a3 个体工商户 %s', (scheme) => {
  it('映射全部明细并通过真实SQLite建账、录入过账、科目汇总及重新打开', async () => {
    const mapped = mapTemplateScheme(template, parseCodeScheme(scheme));
    const configured = defineServerModule(manifest, {
      router: kit.router({}),
      templates: [{ ...mapped, id: `${template.id}-${scheme}` }],
    });
    const app = await createTestApp({
      modules: [configured],
      templateId: `${template.id}-${scheme}`,
      seed: false,
    });
    try {
      const rows = await app.svc.accounts.list();
      expect(rows).toHaveLength(34);
      const inventoryCode = scheme === '3-2-2' ? '12101' : '121001';
      const inventory = await app.svc.accounts.require(inventoryCode);
      const parent = await app.svc.accounts.require('121');
      expect(inventory).toMatchObject({
        parentId: parent.id,
        level: 2,
        fullName: '存货/材料',
        isLeaf: true,
      });
      expect(parent.isLeaf).toBe(false);
      expect(await app.svc.accounts.provenance(inventory.id)).toMatchObject({
        sourceVersion: '财会字〔1997〕19号',
      });
      const transactions = [
        [
          { account: '102', debit: 100_001 },
          { account: '301', credit: 100_001 },
        ],
        [
          { account: inventoryCode, debit: 35_001 },
          { account: '102', credit: 35_001 },
        ],
        [
          { account: '101', debit: 60_001 },
          { account: '501', credit: 60_001 },
        ],
        [
          { account: '502', debit: 20_001 },
          { account: inventoryCode, credit: 20_001 },
        ],
        [
          { account: '521', debit: 1_001 },
          { account: '102', credit: 1_001 },
        ],
      ];
      for (const lines of transactions) {
        const input = await voucherInputFromSpec(app.svc, { date: '2026-01-05', lines });
        const voucher = await app.svc.vouchers.create(input);
        await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
        await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
      }
      const balances = await app.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: [inventoryCode],
      });
      expect(balances[0]).toMatchObject({ debit: 35_001, credit: 20_001, closing: 15_000 });
      const trial = await app.svc.ledger.trialBalance(202601, 202601);
      expect(trial.balanced).toBe(true);
      await app.runtime.bookStore.close(app.book.id);
      app.runtime.bookStore.open(app.book.id);
      expect(await app.core().accounts.list()).toEqual(rows);
      expect((await app.core().auth.me()).book.templateId).toBe(`${template.id}-${scheme}`);
    } finally {
      await app.close();
    }
  });
});

it('w_xt_kgzb_3 个体工商户：往来对象必填，错误输入不留凭证，正常往来可按对象查询', async () => {
  const app = await createTestApp({ modules: [fixture], templateId: template.id, seed: false });
  try {
    const input = await voucherInputFromSpec(app.svc, {
      date: '2026-01-08',
      lines: [
        { account: '111', debit: 10_001 },
        { account: '501', credit: 10_001 },
      ],
    });
    await expect(app.svc.vouchers.create(input)).rejects.toMatchObject({
      data: { code: 'VOUCHER_INVALID' },
    });
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const party = await app.svc.dimensions.create({
      type: 'partner',
      code: 'A01',
      name: '合成购货对象',
    });
    input.lines[0]!.dimensions = { partner: party.id };
    const voucher = await app.svc.vouchers.create(input);
    expect(voucher.number).toBe(1);
    expect(
      (
        await app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['111'],
          groupBy: ['partner'],
          includeUnposted: true,
        })
      )[0],
    ).toMatchObject({ dimensions: { partner: party.id }, closing: 10_001 });
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_a2 个体工商户：正式模板注册且错误一级宽度拒绝', async () => {
  const app = await createTestApp({ modules: [fixture], templateId: template.id, seed: false });
  try {
    const listed = await app.core(null).books.templates();
    expect(listed.find((entry) => entry.id === template.id)).toMatchObject({
      name: template.name,
      regime: 'individual-business',
    });
    const before = await app.core().books.list();
    await expect(
      app.core().books.create({
        name: '错误级次合成账',
        orgName: '合成单位',
        templateId: template.id,
        codeScheme: '4-2-2',
        product: 'chengben',
        startYear: 2026,
        startMonth: 1,
      }),
    ).rejects.toThrow(/不能使用科目级次/);
    expect(await app.core().books.list()).toEqual(before);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_3 个体工商户：月度保留当期收入费用，年度手工结转分别处理以前亏损与税后支出', async () => {
  const app = await createTestApp({ modules: [fixture], templateId: template.id, seed: false });
  try {
    const loss = await app.svc.accounts.create(
      { code: '3110201', name: '2025年度' },
      parseCodeScheme('3-2-2'),
    );
    const bank = await app.svc.accounts.require('102');
    const owner = await app.svc.accounts.require('301');
    // 合成期初：业主投入1000元，上年经营亏损10元，余银行存款990元。
    await app.svc.opening.upsert({ year: 2026, accountId: loss.id, balance: 1_000 });
    await app.svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 99_000 });
    await app.svc.opening.upsert({ year: 2026, accountId: owner.id, balance: -100_000 });
    const post = async (
      date: string,
      lines: Parameters<typeof voucherInputFromSpec>[1]['lines'],
    ) => {
      const voucher = await app.svc.vouchers.create(
        await voucherInputFromSpec(app.svc, { date, lines }),
      );
      await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await app.svc.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
    };
    await post('2026-01-05', [
      { account: '102', debit: 10_000 },
      { account: '501', credit: 10_000 },
    ]);
    await post('2026-01-06', [
      { account: '504', debit: 2_000 },
      { account: '102', credit: 2_000 },
    ]);
    await post('2026-01-07', [
      { account: '521', debit: 700 },
      { account: '102', credit: 700 },
    ]);
    const balance = async (code: string, to: number) =>
      (
        await app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: to,
          accountCodes: [code],
        })
      )[0]?.closing ?? 0;
    expect(await balance('501', 202601)).toBe(-10_000);
    expect(await balance('504', 202601)).toBe(2_000);
    expect(await balance('521', 202601)).toBe(700);
    expect(await balance('31101', 202601)).toBe(0);
    expect(await balance('3110201', 202601)).toBe(1_000);
    // 模板只提供科目；这里按原制度演示会计手工结转，不调用其它模块或推定税额。
    await post('2026-12-31', [
      { account: '501', debit: 10_000 },
      { account: '31101', credit: 10_000 },
    ]);
    await post('2026-12-31', [
      { account: '31101', debit: 2_000 },
      { account: '504', credit: 2_000 },
    ]);
    // 当年经营所得80元，弥补以前年度10元后转留存70元。
    await post('2026-12-31', [
      { account: '31101', debit: 1_000 },
      { account: '3110201', credit: 1_000 },
    ]);
    await post('2026-12-31', [
      { account: '31101', debit: 7_000 },
      { account: '312', credit: 7_000 },
    ]);
    // 税后支出7元只转留存利润，不冲减本年经营所得。
    await post('2026-12-31', [
      { account: '312', debit: 700 },
      { account: '521', credit: 700 },
    ]);
    expect(await balance('31101', 202612)).toBe(0);
    expect(await balance('3110201', 202612)).toBe(0);
    expect(await balance('521', 202612)).toBe(0);
    expect(await balance('312', 202612)).toBe(-6_300);
    expect(await balance('102', 202612)).toBe(106_300);
    expect((await app.svc.ledger.trialBalance(202601, 202612)).balanced).toBe(true);
    // 查一月仍是当时状态，年末的转出不会反写历史月度查询。
    expect(await balance('521', 202601)).toBe(700);
    expect(await balance('3110201', 202601)).toBe(1_000);
  } finally {
    await app.close();
  }
});
