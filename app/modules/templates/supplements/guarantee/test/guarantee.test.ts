import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  levelOfCode,
  parentCodeOf,
  parseCodeScheme,
  parseTemplate,
  templateProblems,
} from '@caiwu/core';
import { TemplateRegistry, createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestBook, seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import {
  baseTemplateId,
  baseVersion,
  composeGuaranteePreset,
  guaranteePresets,
  guaranteeApplicability,
  supplement,
  type GuaranteePresetId,
} from '../index';
import { readEnterpriseBaseForTest } from './base';

const base = readEnterpriseBaseForTest();
const guaranteeTemplates = guaranteePresets.map((preset) =>
  composeGuaranteePreset(preset.id as GuaranteePresetId, base),
);
const cases = guaranteePresets.map((preset) => ({
  ...preset,
  id: preset.id as GuaranteePresetId,
  ...guaranteeApplicability[preset.id as GuaranteePresetId],
}));

const expected = [
  ['1303', '贷款', 'asset', 'debit', false],
  ['1304', '贷款损失准备', 'asset', 'credit', true],
  ['4102', '一般风险准备', 'equity', 'credit', false],
  ['6011', '利息收入', 'pnl', 'credit', false],
  ['6411', '利息支出', 'pnl', 'debit', false],
  ['6421', '手续费及佣金支出', 'pnl', 'debit', false],
  ['6601', '业务及管理费', 'pnl', 'debit', false],
] as const;

it('w_xt_kgzb_a2 行业选择：三预设独立注册，不注册只读基表，不夹带旧制度或银行存款业务', () => {
  const registry = new TemplateRegistry({ devMode: false });
  registry.register('guarantee-isolated-test', guaranteeTemplates);
  expect(registry.list().map((template) => template.id)).toEqual([
    'financing-guarantee-cas22-2026',
    'financing-guarantee-cas25-2026',
    'microloan-enterprise-cas22-2026',
  ]);
  expect(() => registry.get(baseTemplateId)).toThrow(/不存在/);
  for (const template of guaranteeTemplates) {
    expect(template.status).toBe('current');
    expect(template.devOnly).toBe(false);
    expect(template.description).toContain('2026-01-01');
    expect(template.description).toContain(`${baseTemplateId}@${baseVersion}`);
    for (const code of ['2011', '1501', '1502', '1503', '2601', '2602', '6031', '6501', '6502'])
      expect(template.accounts.find((account) => account.code === code)?.disabled).toBe(true);
    expect(template.reports).toEqual([]);
    expect(template.sources.every((source) => source.title.length > 0)).toBe(true);
    expect(template.accounts.every((account) => account.source && account.sourceVersion)).toBe(
      true,
    );
  }
  expect(
    registry.get('financing-guarantee-cas22-2026').accounts.find((a) => a.code === '2603')
      ?.disabled,
  ).toBe(true);
  expect(supplement.presets).toBe(guaranteePresets);
  expect(supplement.templates).toBeUndefined();
});

it('w_xt_kgzb_a3 科目设定：小贷逐项核对行业科目方向、备抵、损益及辅助；利息调整允许两侧余额', () => {
  const template = composeGuaranteePreset('microloan-enterprise-cas22-2026', base);
  for (const [code, name, category, direction, isContra] of expected)
    expect(template.accounts.find((account) => account.code === code)).toMatchObject({
      code,
      name,
      category,
      direction,
      isContra,
    });
  expect(template.accounts.find((a) => a.code === '130302')).toMatchObject({
    balanceNature: 'both',
  });
  for (const code of ['130301', '130302', '130303', '1304', '1132', '6011'])
    expect(template.accounts.find((a) => a.code === code)?.dimensions).toEqual([
      { type: 'project', required: true },
      { type: 'partner', required: true },
    ]);
  for (const code of ['6011', '6411', '6421', '6601'])
    expect(template.accounts.find((a) => a.code === code)?.closingRule).toBe('profit');
  expect(template.accounts.find((a) => a.code === '4102')?.closingRule).toBe('none');
});

it('w_xt_kgzb_a3 科目设定：省略维度的覆盖保留基表辅助，不污染只读基表', () => {
  const withDimension = structuredClone(base);
  withDimension.accounts.find((account) => account.code === '6601')!.dimensions = [
    { type: 'department', required: false },
  ];
  const before = structuredClone(withDimension);
  const composed = composeGuaranteePreset('microloan-enterprise-cas22-2026', withDimension);
  expect(composed.accounts.find((account) => account.code === '6601')?.dimensions).toEqual([
    { type: 'department', required: false },
  ]);
  expect(withDimension).toEqual(before);
});

it('w_xt_kgzb_a2 保险合同口径：现行科目按合同组辅助，单项合同选择条件明确', () => {
  const template = composeGuaranteePreset('financing-guarantee-cas25-2026', base);
  const insurance = [
    ['2603', '未到期责任负债', 'credit'],
    ['2604', '已发生赔款负债', 'credit'],
    ['1213', '分保摊回未到期责任资产', 'debit'],
    ['1214', '分保摊回已发生赔款资产', 'debit'],
    ['1215', '保险获取现金流量资产', 'debit'],
    ['6032', '保险服务收入', 'credit'],
    ['6503', '保险合同赔付和费用', 'debit'],
    ['6504', '亏损保险合同损益', 'debit'],
    ['6505', '分出保费的分摊', 'debit'],
    ['6506', '摊回保险服务费用', 'credit'],
    ['5404', '待结转支出', 'debit'],
    ['6507', '承保财务损益', 'debit'],
    ['6508', '分出再保险财务损益', 'credit'],
  ];
  for (const [code, name, direction] of insurance)
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      name,
      direction,
      dimensions: [{ type: 'project', required: true }],
    });
  expect(template.description).toContain('满足准则选择条件');
  const preset = cases.find((item) => item.id === template.id)!;
  expect(preset.applicableTo).toContain('不可撤销');
  expect(preset.applicableTo).toContain('已按保险合同');
});

describe.each(['4-2-2', '4-3-3'] as const)('w_xt_kgzb_1 信息确认与一键初始：%s', (scheme) => {
  it.each(cases)('$id 编码、父链、来源及辅助完整映射', (preset) => {
    const template = composeGuaranteePreset(preset.id, base, scheme);
    expect(templateProblems(template)).toEqual([]);
    const codeScheme = parseCodeScheme(scheme);
    const codes = new Set(template.accounts.map((account) => account.code));
    expect(codes.size).toBe(template.accounts.length);
    for (const account of template.accounts) {
      expect(levelOfCode(account.code, codeScheme)).not.toBeNull();
      const parent = parentCodeOf(account.code, codeScheme);
      if (parent) expect(codes.has(parent)).toBe(true);
    }
    const native = composeGuaranteePreset(preset.id, base);
    expect(
      template.accounts.map((a) => [
        a.name,
        a.direction,
        a.isContra,
        a.balanceNature,
        a.dimensions,
        a.sourceVersion,
      ]),
    ).toEqual(
      native.accounts.map((a) => [
        a.name,
        a.direction,
        a.isContra,
        a.balanceNature,
        a.dimensions,
        a.sourceVersion,
      ]),
    );
  });

  it.each(cases)('$id 真实合成账套保存版本、末级凭证、辅助分组与重开余额', async (preset) => {
    const book = await createTestBook({
      templates: guaranteeTemplates,
      templateId: preset.id,
      codeScheme: scheme,
    });
    const code = (native: string) =>
      native.length === 6 && scheme === '4-3-3'
        ? `${native.slice(0, 4)}0${native.slice(4)}`
        : native;
    const contract = { partner: 'C001', project: 'XM01' };
    const group = { project: 'XM01' };
    try {
      expect(
        book.book.raw.prepare('SELECT template_id, template_version FROM book_info').get(),
      ).toEqual({ template_id: preset.id, template_version: preset.version });
      for (const [account, balance] of [
        ['1002', 1_000_000],
        ['4001', -1_000_000],
      ] as const)
        await book.svc.opening.upsert({
          year: 2026,
          accountId: (await book.svc.accounts.require(account)).id,
          balance,
        });
      let expectedBalances: [string, number][];
      if (preset.originalTemplate === 'a32') {
        expect((await book.svc.accounts.require('1303')).isLeaf).toBe(false);
        expect((await book.svc.accounts.require('1304')).isContra).toBe(true);
        await expect(
          book.svc.opening.upsert({
            year: 2026,
            accountId: (await book.svc.accounts.require('1303')).id,
            balance: 1,
          }),
        ).rejects.toThrow(/不是末级/);
        await seedVouchers(book.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: code('130301'), debit: 200_000, dims: contract },
              { account: '1002', credit: 200_000 },
            ],
          },
          {
            // 贷款方另付符合条件的增量交易费用；本金足额支付，不向借款人预扣息费。
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: code('130302'), debit: 300, dims: contract },
              { account: '1002', credit: 300 },
            ],
          },
          {
            date: '2026-01-06',
            status: 'posted',
            lines: [
              { account: code('130303'), debit: 5_000, dims: contract },
              { account: '6011', credit: 5_000, dims: contract },
            ],
          },
          {
            // 到期可收取但尚未收到时，才转入1132。
            date: '2026-01-07',
            status: 'posted',
            lines: [
              { account: '1132', debit: 5_000, dims: contract },
              { account: code('130303'), credit: 5_000, dims: contract },
            ],
          },
          {
            date: '2026-01-07',
            status: 'posted',
            lines: [
              { account: '1002', debit: 55_000 },
              { account: code('130301'), credit: 50_000, dims: contract },
              { account: '1132', credit: 5_000, dims: contract },
            ],
          },
          {
            date: '2026-01-08',
            status: 'posted',
            lines: [
              { account: '6702', debit: 3_000 },
              { account: '1304', credit: 3_000, dims: contract },
            ],
          },
        ]);
        expectedBalances = [
          ['1002', 854_700],
          [code('130301'), 150_000],
          [code('130302'), 300],
          ['1303', 150_300],
          ['1304', -3_000],
          ['6011', -5_000],
          ['6702', 3_000],
        ];
      } else if (preset.id === 'financing-guarantee-cas22-2026') {
        await seedVouchers(book.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: '1002', debit: 40_000 },
              { account: '2002', credit: 40_000, dims: { partner: 'C001' } },
            ],
          },
          {
            date: '2026-01-06',
            status: 'posted',
            lines: [
              { account: '1031', debit: 25_000, dims: { partner: 'C001' } },
              { account: '1002', credit: 25_000 },
            ],
          },
          {
            date: '2026-01-07',
            status: 'posted',
            lines: [
              { account: '6702', debit: 3_000 },
              { account: code('280101'), credit: 3_000, dims: contract },
            ],
          },
          {
            date: '2026-01-08',
            status: 'posted',
            lines: [
              { account: code('280101'), debit: 1_000, dims: contract },
              { account: '1002', credit: 1_000 },
            ],
          },
        ]);
        expectedBalances = [
          ['1002', 1_014_000],
          ['1031', 25_000],
          ['2002', -40_000],
          [code('280101'), -2_000],
          ['2801', -2_000],
          ['6702', 3_000],
        ];
      } else {
        // 已由人工确认计量额的短期合同组合成数据，不把本例当作计量或保费分配法引擎。
        await seedVouchers(book.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: '1002', debit: 12_000 },
              { account: '2603', credit: 12_000, dims: group },
            ],
          },
          {
            date: '2026-01-06',
            status: 'posted',
            lines: [
              { account: '2603', debit: 1_000, dims: group },
              { account: '6032', credit: 1_000, dims: group },
            ],
          },
          {
            date: '2026-01-07',
            status: 'posted',
            lines: [
              { account: '6503', debit: 500, dims: group },
              { account: '2604', credit: 500, dims: group },
            ],
          },
          {
            date: '2026-01-08',
            status: 'posted',
            lines: [
              { account: '2604', debit: 200, dims: group },
              { account: '1002', credit: 200 },
            ],
          },
        ]);
        expectedBalances = [
          ['1002', 1_011_800],
          ['2603', -11_000],
          ['2604', -300],
          ['6032', -1_000],
          ['6503', 500],
        ];
      }
      const query = { periodFrom: 202601, periodTo: 202601 };
      const balances = await book.svc.ledger.balances(query);
      for (const [account, closing] of expectedBalances)
        expect(balances.find((row) => row.accountCode === account)?.closing).toBe(closing);
      expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      const dimensionCode =
        preset.originalTemplate === 'a32'
          ? code('130301')
          : preset.id.includes('cas22')
            ? code('280101')
            : '2603';
      const grouped = await book.svc.ledger.balances({
        ...query,
        accountCodes: [dimensionCode],
        groupBy: ['project'],
      });
      expect(grouped.some((row) => row.dimensions.project != null)).toBe(true);
      await book.store.close(book.info.id);
      const reopened = book.store.open(book.info.id);
      const again = createCoreServices({
        ...book.svc.ctx,
        db: reopened.db,
        user: (await loadServiceUser(reopened.db, 1))!,
      });
      expect(await again.ledger.balances(query)).toEqual(balances);
    } finally {
      await book.close();
    }
  });
});

it('w_xt_kgzb_3 一键初始：基表版本、同码错名、错误方向/备抵、非法层级及重复编码全部拒绝', () => {
  const base = readEnterpriseBaseForTest();
  const invalid = [
    { ...base, id: 'small-business' },
    { ...base, version: 'unreviewed' },
    { ...base, accounts: [...base.accounts, base.accounts[0]!] },
    {
      ...base,
      accounts: base.accounts.map((a) => (a.code === '1304' ? { ...a, direction: 'debit' } : a)),
    },
    {
      ...base,
      accounts: base.accounts.map((a) => (a.code === '1304' ? { ...a, isContra: false } : a)),
    },
    {
      ...base,
      accounts: base.accounts.map((a) => (a.code === '6601' ? { ...a, name: '错误名称' } : a)),
    },
    { ...base, accounts: [...base.accounts, { ...base.accounts[0]!, code: '999901' }] },
    { ...base, accounts: [...base.accounts, { ...base.accounts[0]!, code: '10011' }] },
  ];
  for (const bad of invalid)
    expect(() => composeGuaranteePreset('microloan-enterprise-cas22-2026', bad)).toThrow();
  const copy = readEnterpriseBaseForTest();
  copy.accounts[0]!.name = '不得污染内部快照';
  expect(readEnterpriseBaseForTest().accounts[0]!.name).toBe('库存现金');
  expect(() => parseTemplate({ ...base, codeScheme: '3-2-2' })).toThrow();
});

it.each([
  { id: 'financing-guarantee-cas22-2026' as const, account: '280101', missing: 'partner' as const },
  { id: 'financing-guarantee-cas22-2026' as const, account: '280101', missing: 'project' as const },
  { id: 'financing-guarantee-cas25-2026' as const, account: '2603', missing: 'project' as const },
])('w_pzedit 担保辅助缺项拒绝且不落账：$id / $missing', async (scenario) => {
  const book = await createTestBook({ templates: guaranteeTemplates, templateId: scenario.id });
  try {
    const dims =
      scenario.missing === 'partner'
        ? { project: 'XM01' }
        : scenario.id.includes('cas22')
          ? { partner: 'C001' }
          : {};
    const input = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1002', debit: 100 },
        { account: scenario.account, credit: 100, dims },
      ],
    });
    await expect(book.svc.vouchers.create(input)).rejects.toThrow(/需要填写/);
    expect((await book.svc.vouchers.list({})).total).toBe(0);
  } finally {
    await book.close();
  }
});

it('w_pzedit 凭证输入：末级、客户、合同及借贷平衡失败时不产生凭证；利息调整不强制单向发生', async () => {
  const book = await createTestBook({
    templates: guaranteeTemplates,
    templateId: 'microloan-enterprise-cas22-2026',
  });
  try {
    const input = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '130301', debit: 123, dims: { partner: 'C001', project: 'XM01' } },
        { account: '1002', credit: 123 },
      ],
    });
    const first = input.lines[0]!;
    for (const bad of [
      {
        ...input,
        lines: [
          { ...first, accountId: (await book.svc.accounts.require('1303')).id },
          input.lines[1]!,
        ],
      },
      {
        ...input,
        lines: [{ ...first, dimensions: { project: first.dimensions.project } }, input.lines[1]!],
      },
      {
        ...input,
        lines: [{ ...first, dimensions: { partner: first.dimensions.partner } }, input.lines[1]!],
      },
      { ...input, lines: [first, { ...input.lines[1]!, credit: 122 }] },
      { ...input, lines: [{ ...first, entrySide: 'credit' as const }, input.lines[1]!] },
    ])
      await expect(book.svc.vouchers.create(bad)).rejects.toThrow();
    expect((await book.svc.vouchers.list({})).total).toBe(0);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100_000 }), async (amount) => {
        await seedVouchers(book.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: '130302', debit: amount, dims: { partner: 'C001', project: 'XM01' } },
              { account: '1002', credit: amount },
            ],
          },
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account: '1002', debit: amount },
              { account: '130302', credit: amount, dims: { partner: 'C001', project: 'XM01' } },
            ],
          },
        ]);
        expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      }),
      { numRuns: 8 },
    );
    const balances = await book.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      includeZero: true,
    });
    expect(balances.find((row) => row.accountCode === '130302')?.closing).toBe(0);
  } finally {
    await book.close();
  }
});
