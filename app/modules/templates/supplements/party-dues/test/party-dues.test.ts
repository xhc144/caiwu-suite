import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balanceSide, parseTemplate, type AccountingTemplate } from '@caiwu/core';
import { createTestBook, seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import {
  getPartyDuesTemplate,
  parsePartyDuesTemplate,
  PARTY_DUES_CODE_SCHEMES,
  partyDuesSupplement,
  partyDuesTemplates,
  supplement,
  type PartyDuesCodeScheme,
} from '../index';

// 独立核读济航〔2021〕30号第八项。编号、方向、辅助是本应用的固定映射，非原文编号。
const sourceRows = [
  ['101', '现金', 'asset', 'debit'],
  ['102', '银行存款', 'asset', 'debit'],
  ['103', '有价证券', 'asset', 'debit'],
  ['104', '暂付款', 'asset', 'debit'],
  ['106', '固定资产', 'asset', 'debit'],
  ['301', '固定基金', 'net-assets', 'credit'],
  ['303', '党费结余', 'net-assets', 'credit'],
  ['401', '党费收入', 'revenue', 'credit'],
  ['402', '上级补助收入', 'revenue', 'credit'],
  ['403', '党费利息收入', 'revenue', 'credit'],
  ['404', '其它收入', 'revenue', 'credit'],
  ['501', '党费支出', 'expense', 'debit'],
  ['50101', '党员培训费', 'expense', 'debit'],
  ['50102', '党员教育费', 'expense', 'debit'],
  ['50103', '党内表彰费', 'expense', 'debit'],
  ['50104', '生活困难党员补助费', 'expense', 'debit'],
  ['502', '补助下级支出', 'expense', 'debit'],
  ['503', '上缴党费支出', 'expense', 'debit'],
] as const;

function codeFor(code: string, scheme: PartyDuesCodeScheme) {
  return scheme === '3-3-3' && code.length > 3 ? `${code.slice(0, 3)}0${code.slice(3)}` : code;
}

const setup = (scheme: PartyDuesCodeScheme = '3-2-2') =>
  createTestBook({
    templates: [...partyDuesTemplates],
    templateId: partyDuesSupplement.templateId,
    codeScheme: scheme,
    startYear: 2026,
    startMonth: 1,
    seed: false,
  });

it('w_xt_kgzb_a2：地方文件范围、起始日、原版对应及应用映射明确，不冒称全国或双体系', () => {
  expect(partyDuesSupplement).toMatchObject({
    originalTemplate: 'a46.acd',
    baseTemplateId: null,
    baseVersion: null,
    effectiveFrom: '2021-04-30',
    defaultForAllPartyOrganizations: false,
    originalAccountTableRecovered: false,
    codeAuthority: 'application-preset',
  });
  expect(partyDuesTemplates).toHaveLength(1);
  expect(supplement.templates).toBe(partyDuesTemplates);
  expect(supplement.presets).toBeUndefined();
  const template = getPartyDuesTemplate();
  expect(template.status).toBe('deprecated');
  expect(template.name).toContain('济宁港航2021');
  expect(template.description).toContain('不作全国党组织的默认制度');
  expect(template.description).toContain('不是行政事业单位政府会计双体系');
  expect(template.sources[0]?.file).toBe(
    'https://www.jining.gov.cn/art/2021/4/30/art_59679_2722747.html',
  );
  expect(template.sources[0]?.note).toContain('未列编号或方向');
  expect(template.reports).toEqual([]);
  expect(template.currencies).toEqual([]);
  expect(template.categories.find((category) => category.id === 'liability')).toBeDefined();
  expect(template.accounts.filter((account) => account.category === 'liability')).toEqual([]);
});

describe.each(PARTY_DUES_CODE_SCHEMES)('党费编码级次 %s', (scheme) => {
  it('w_xt_kgzb_a2/a3：18项来源名称逐项一致，保持类别、方向、资金辅助及来源版本', () => {
    const template = getPartyDuesTemplate(scheme);
    expect(
      template.accounts.map(({ code, name, category, direction }) => [
        code,
        name,
        category,
        direction,
      ]),
    ).toEqual(sourceRows.map(([code, ...rest]) => [codeFor(code, scheme), ...rest]));
    expect(template.accounts.filter((account) => account.code.length === 3)).toHaveLength(14);
    expect(template.accounts.filter((account) => account.code.length > 3)).toHaveLength(4);
    for (const account of template.accounts) {
      const needsProject =
        ['104', '303'].includes(account.code) || ['4', '5'].includes(account.code[0]!);
      expect(
        account.dimensions.some((dimension) => dimension.type === 'project' && dimension.required),
      ).toBe(needsProject);
      expect(
        account.dimensions.some((dimension) => dimension.type === 'partner' && dimension.required),
      ).toBe(account.code === '104');
      expect(account.source).toContain('济航〔2021〕30号第八项');
      expect(account.source).toContain('应用映射');
      expect(account.sourceVersion).toBe('济航〔2021〕30号；应用预置1.0.0');
      expect(account.closingRule).toBe('none');
      expect(account.balanceNature).toBe(account.code === '303' ? 'both' : account.direction);
    }
    expect(template.categories.every((category) => !category.isPnl)).toBe(true);
    expect(
      template.accounts.filter((account) => account.cash).map((account) => account.code),
    ).toEqual(['101']);
    expect(
      template.accounts.filter((account) => account.bank).map((account) => account.code),
    ).toEqual(['102']);
  });

  it('w_xt_kgzb_3：真实SQLite建账保存方向、父链、末级、辅助和来源；辅助档案不含真实或预设对象', async () => {
    const book = await setup(scheme);
    try {
      expect(book.info.codeScheme.join('-')).toBe(scheme);
      expect(book.info.regime).toBe('party-dues-jining-port-2021');
      const accounts = await book.svc.accounts.list();
      expect(accounts).toHaveLength(18);
      const parent = await book.svc.accounts.require('501');
      expect(parent).toMatchObject({ level: 1, isLeaf: false, parentId: null });
      for (const [code, name, category, direction] of sourceRows) {
        const account = await book.svc.accounts.require(codeFor(code, scheme));
        expect(account).toMatchObject({
          name,
          categoryId: category,
          direction,
          level: code.length > 3 ? 2 : 1,
          parentId: code.length > 3 ? parent.id : null,
          isLeaf: code !== '501',
          sourceVersion: '济航〔2021〕30号；应用预置1.0.0',
        });
      }
      expect(await book.svc.dimensions.items()).toEqual([]);
      expect(await book.svc.opening.list(2026)).toEqual([]);
      expect((await book.svc.vouchers.list({})).total).toBe(0);
      expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    } finally {
      await book.close();
    }
  });

  it('w_xt_kgzb_3：普通/专项收入、利息、培训、下拨、上缴和暂付款的过账余额分别核对', async () => {
    const book = await setup(scheme);
    try {
      const general = await book.svc.dimensions.create({
        type: 'project',
        code: 'G',
        name: '合成普通党费',
      });
      const special = await book.svc.dimensions.create({
        type: 'project',
        code: 'S',
        name: '合成指定用途资金',
      });
      const debtor = await book.svc.dimensions.create({
        type: 'partner',
        code: 'D',
        name: '合成借款对象',
      });
      await book.svc.opening.upsert({
        year: 2026,
        accountId: (await book.svc.accounts.require('102')).id,
        balance: 100_00,
      });
      await book.svc.opening.upsert({
        year: 2026,
        accountId: (await book.svc.accounts.require('303')).id,
        dimensions: { project: general.id },
        balance: -100_00,
      });
      await seedVouchers(book.svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '102', debit: 1_000_00 },
            { account: '401', credit: 1_000_00, dims: { project: 'G' } },
          ],
        },
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '102', debit: 2_000_00 },
            { account: '402', credit: 2_000_00, dims: { project: 'S' } },
          ],
        },
        {
          date: '2026-01-06',
          status: 'posted',
          lines: [
            { account: '102', debit: 5_00 },
            { account: '403', credit: 5_00, dims: { project: 'G' } },
          ],
        },
        {
          date: '2026-01-07',
          status: 'posted',
          lines: [
            { account: codeFor('50101', scheme), debit: 300_00, dims: { project: 'S' } },
            { account: '102', credit: 300_00 },
          ],
        },
        {
          date: '2026-01-08',
          status: 'posted',
          lines: [
            { account: '502', debit: 200_00, dims: { project: 'S' } },
            { account: '102', credit: 200_00 },
          ],
        },
        {
          date: '2026-01-09',
          status: 'posted',
          lines: [
            { account: '503', debit: 100_00, dims: { project: 'G' } },
            { account: '102', credit: 100_00 },
          ],
        },
        {
          date: '2026-01-10',
          status: 'posted',
          lines: [
            { account: '104', debit: 40_00, dims: { project: 'S', partner: 'D' } },
            { account: '102', credit: 40_00 },
          ],
        },
        {
          date: '2026-01-11',
          status: 'posted',
          lines: [
            { account: '102', debit: 10_00 },
            { account: '104', credit: 10_00, dims: { project: 'S', partner: 'D' } },
          ],
        },
      ]);
      const rows = await book.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
      const closing = (code: string) =>
        rows.find((row) => row.accountCode === codeFor(code, scheme))?.closing;
      expect(closing('102')).toBe(2_475_00);
      expect(closing('104')).toBe(30_00);
      expect(closing('303')).toBe(-100_00);
      expect(closing('401')).toBe(-1_000_00);
      expect(closing('402')).toBe(-2_000_00);
      expect(closing('403')).toBe(-5_00);
      expect(closing('501')).toBe(300_00);
      expect(closing('50101')).toBe(300_00);
      expect(closing('502')).toBe(200_00);
      expect(closing('503')).toBe(100_00);
      expect(balanceSide(closing('401')!, 'credit')).toEqual({ side: '贷', amount: 1_000_00 });
      expect(rows.filter((row) => row.isLeaf).reduce((sum, row) => sum + row.closing, 0)).toBe(0);
      const grouped = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        groupBy: ['project'],
        rollup: false,
      });
      // 这里只计算指定科目的收支差额，不冒称法定报表或自动年末结转。
      const available = (project: number) =>
        -grouped
          .filter(
            (row) =>
              row.dimensions.project === project &&
              ['303', '401', '402', '403', '404', '501', '502', '503'].some((root) =>
                row.accountCode.startsWith(root),
              ),
          )
          .reduce((sum, row) => sum + row.closing, 0);
      expect(available(general.id)).toBe(1_005_00);
      expect(available(special.id)).toBe(1_500_00);
      const advances = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['104'],
        groupBy: ['project', 'partner'],
      });
      expect(advances).toHaveLength(1);
      expect(advances[0]).toMatchObject({
        dimensions: { project: special.id, partner: debtor.id },
        closing: 30_00,
      });
      expect(await book.svc.ledger.trialBalance(202601, 202601)).toMatchObject({
        balanced: true,
        openingDebit: 100_00,
        openingCredit: 100_00,
      });
    } finally {
      await book.close();
    }
  });
});

it('w_xt_kgzb_a3/f_getaccountlist：重复编码、孤儿、非法级次、空表和错误方向或辅助配置均拒绝', () => {
  const change = (fn: (template: AccountingTemplate) => void) => {
    const template = getPartyDuesTemplate();
    fn(template);
    return template;
  };
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts.push(template.accounts[0]!);
      }),
    ),
  ).toThrow(/重复/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts = template.accounts.filter((account) => account.code !== '501');
      }),
    ),
  ).toThrow(/上级/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts[0]!.code = '1010';
      }),
    ),
  ).toThrow(/长度/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts = [];
      }),
    ),
  ).toThrow();
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.codeScheme = '3-0-2';
      }),
    ),
  ).toThrow(/长度/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts.find((account) => account.code === '401')!.direction = 'debit';
      }),
    ),
  ).toThrow(/方向/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.accounts.find((account) => account.code === '50101')!.dimensions = [];
      }),
    ),
  ).toThrow(/核算配置/);
  expect(() =>
    parsePartyDuesTemplate(
      change((template) => {
        template.categories.find((category) => category.id === 'revenue')!.isPnl = true;
      }),
    ),
  ).toThrow(/结转配置/);
  expect(() => getPartyDuesTemplate('4-2-2' as PartyDuesCodeScheme)).toThrow(/3-2-2或3-3-3/);
  expect(() => parseTemplate(getPartyDuesTemplate(), [4, 2, 2])).toThrow(/编码长度/);
  const first = getPartyDuesTemplate();
  first.accounts[0]!.name = '测试变更';
  expect(getPartyDuesTemplate().accounts[0]!.name).toBe('现金');
});

it('w_xt_kgzb_3/w_pz_pzedit：非末级、漏项目、错类型/停用/非末级辅助和不平衡凭证被拒绝且不占号', async () => {
  const book = await setup();
  try {
    const valid = await book.svc.dimensions.create({
      type: 'project',
      code: 'V',
      name: '合成有效项目',
    });
    const wrong = await book.svc.dimensions.create({ type: 'person', code: 'P', name: '合成个人' });
    const disabled = await book.svc.dimensions.create({
      type: 'project',
      code: 'X',
      name: '合成停用项目',
      disabled: true,
    });
    const parent = await book.svc.dimensions.create({
      type: 'project',
      code: 'R',
      name: '合成分组',
    });
    await book.svc.dimensions.create({
      type: 'project',
      code: 'R1',
      name: '合成子项目',
      parentId: parent.id,
    });
    const raw = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '50101', debit: 123 },
        { account: '102', credit: 123 },
      ],
    });
    for (const id of [undefined, wrong.id, disabled.id, parent.id, 999999]) {
      await expect(
        book.svc.vouchers.create({
          ...raw,
          lines: raw.lines.map((line, index) =>
            index === 0 ? { ...line, dimensions: id ? { project: id } : {} } : line,
          ),
        }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    }
    raw.lines[0]!.dimensions = { project: valid.id };
    await expect(
      book.svc.vouchers.create({
        ...raw,
        lines: [
          { ...raw.lines[0]!, accountId: (await book.svc.accounts.require('501')).id },
          raw.lines[1]!,
        ],
      }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    await expect(
      book.svc.vouchers.create({
        ...raw,
        lines: [raw.lines[0]!, { ...raw.lines[1]!, credit: 124 }],
      }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    expect((await book.svc.vouchers.list({})).total).toBe(0);
    expect((await book.svc.vouchers.create(raw)).number).toBe(1);
    await expect(
      book.svc.opening.upsert({
        year: 2026,
        accountId: (await book.svc.accounts.require('501')).id,
        balance: 123,
      }),
    ).rejects.toMatchObject({ data: { code: 'OPENING_NOT_LEAF' } });
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_3/w_pz_pzedit：暂付款必须同时指向项目和一个往来对象，不要求同时填个人和单位', async () => {
  const book = await setup();
  try {
    const project = await book.svc.dimensions.create({
      type: 'project',
      code: 'S',
      name: '合成专项',
    });
    const partner = await book.svc.dimensions.create({
      type: 'partner',
      code: 'D',
      name: '合成债务对象',
    });
    const raw = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '104', debit: 123 },
        { account: '102', credit: 123 },
      ],
    });
    for (const dimensions of [{}, { project: project.id }, { partner: partner.id }]) {
      await expect(
        book.svc.vouchers.create({
          ...raw,
          lines: [{ ...raw.lines[0]!, dimensions }, raw.lines[1]!],
        }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    }
    const saved = await book.svc.vouchers.create({
      ...raw,
      lines: [
        { ...raw.lines[0]!, dimensions: { project: project.id, partner: partner.id } },
        raw.lines[1]!,
      ],
    });
    expect(saved.lines[0]?.dimensions).toMatchObject({ project: project.id, partner: partner.id });
    expect(saved.lines[0]?.dimensions.person).toBeNull();
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_3：随机整数分收支保持借贷平衡、末级之和等于父科目、项目汇总等于科目汇总', async () => {
  const book = await setup();
  try {
    for (const code of ['A', 'B'])
      await book.svc.dimensions.create({ type: 'project', code, name: `合成项目${code}` });
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            receipt: fc.integer({ min: 1, max: 1_000_000 }),
            expense: fc.integer({ min: 1, max: 1_000_000 }),
          }),
          { minLength: 2, maxLength: 6 },
        ),
        async (pairs) => {
          const ids: number[] = [];
          try {
            for (const [index, pair] of pairs.entries()) {
              const project = index % 2 ? 'B' : 'A';
              const raw = await voucherInputFromSpec(book.svc, {
                date: '2026-01-05',
                lines: [
                  { account: '102', debit: pair.receipt + pair.expense },
                  { account: '401', credit: pair.receipt + pair.expense, dims: { project } },
                  {
                    account: index % 2 ? '50102' : '50101',
                    debit: pair.expense,
                    dims: { project },
                  },
                  { account: '102', credit: pair.expense },
                ],
              });
              ids.push((await book.svc.vouchers.create(raw)).id);
            }
            const query = { periodFrom: 202601, periodTo: 202601, includeUnposted: true };
            const rows = await book.svc.ledger.balances(query);
            expect(
              rows.filter((row) => row.isLeaf).reduce((sum, row) => sum + BigInt(row.closing), 0n),
            ).toBe(0n);
            const expectedExpense = pairs.reduce((sum, pair) => sum + pair.expense, 0);
            expect(rows.find((row) => row.accountCode === '501')?.closing).toBe(expectedExpense);
            expect(
              rows
                .filter((row) => row.accountCode.startsWith('501') && row.isLeaf)
                .reduce((sum, row) => sum + row.closing, 0),
            ).toBe(expectedExpense);
            const grouped = await book.svc.ledger.balances({
              ...query,
              groupBy: ['project'],
              accountCodes: ['501'],
              rollup: false,
            });
            expect(grouped.reduce((sum, row) => sum + row.closing, 0)).toBe(expectedExpense);
          } finally {
            for (const id of ids) await book.svc.vouchers.delete(id);
          }
        },
      ),
      { numRuns: 12 },
    );
  } finally {
    await book.close();
  }
});
