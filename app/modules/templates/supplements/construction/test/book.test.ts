import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseTemplate, type AccountingTemplate } from '@caiwu/core';
import { createTestBook, seedVouchers, voucherInputFromSpec, type TestBook } from '@caiwu/testkit';
import { buildConstructionTemplates } from '../index';
import enterpriseBase from './fixtures/enterprise-2026.json';
import smallBase from './fixtures/small-business-2013.json';

const constructionTemplates = buildConstructionTemplates([enterpriseBase, smallBase]);

const schemes = ['4-2-2', '4-3-3'];
const cases = constructionTemplates.flatMap((template) =>
  schemes.map((scheme) => ({ template, scheme })),
);

function codeInScheme(code: string, scheme: string) {
  if (scheme === '4-2-2') return code;
  let result = code.slice(0, 4);
  for (let index = 4; index < code.length; index += 2)
    result += code.slice(index, index + 2).padStart(3, '0');
  return result;
}

async function setup(template: AccountingTemplate, scheme: string) {
  return createTestBook({
    templates: [template],
    templateId: template.id,
    codeScheme: scheme,
    seed: false,
  });
}

async function amountAt(book: TestBook, code: string, grouped = false) {
  return book.svc.ledger.balances({
    periodFrom: 202601,
    periodTo: 202601,
    accountCodes: [code],
    groupBy: grouped ? ['project'] : [],
  });
}

describe.each(cases)('w_xt_kgzb_3：$template.id / $scheme', ({ template, scheme }) => {
  const enterprise = template.regime === 'enterprise';
  const code = (input: string) => codeInScheme(input, scheme);
  const contractCost = enterprise ? '1472' : '440101';
  const parent = enterprise ? '1490' : '4401';

  it('真实空白SQLite建账，级次、父子、方向、备抵、来源和零余额持久化', async () => {
    const book = await setup(template, scheme);
    try {
      expect(book.info.templateId).toBe(template.id);
      expect((await book.svc.accounts.list()).length).toBe(template.accounts.length);
      expect(await book.svc.dimensions.items()).toEqual([]);
      expect(await book.svc.opening.list(2026)).toEqual([]);
      expect(await amountAt(book, code(contractCost))).toEqual([]);
      expect(await book.svc.accounts.require(code(parent))).toMatchObject({
        isLeaf: false,
        level: 1,
      });
      const leaf = await book.svc.accounts.require(code(enterprise ? '149001' : '440101'));
      expect(leaf).toMatchObject({ isLeaf: true, level: 2 });
      expect(leaf.parentId).toBe((await book.svc.accounts.require(code(parent))).id);
      expect(await book.svc.accounts.require(code(enterprise ? '1474' : '141103'))).toMatchObject({
        direction: 'credit',
        isContra: true,
      });
      expect(await book.svc.accounts.require(code(contractCost))).toMatchObject({
        direction: 'debit',
        dimensions: [{ type: 'project', required: true, defaultItemId: null }],
      });
      const source = await book.svc.accounts.provenance(leaf.id);
      expect(source).toBeTruthy();
      expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    } finally {
      await book.close();
    }
  });

  it('非末级、缺项目、错误类型/停用/非末级项目及不平衡分录拒绝且不占号', async () => {
    const book = await setup(template, scheme);
    try {
      const person = await book.svc.dimensions.create({
        type: 'person',
        code: 'P01',
        name: '合成人员',
      });
      const disabled = await book.svc.dimensions.create({
        type: 'project',
        code: 'D',
        name: '停用合成合同',
        disabled: true,
      });
      const group = await book.svc.dimensions.create({
        type: 'project',
        code: 'G',
        name: '合成合同分组',
      });
      const valid = await book.svc.dimensions.create({
        type: 'project',
        code: 'A',
        name: '合成合同A',
        parentId: group.id,
      });
      const raw = await voucherInputFromSpec(book.svc, {
        date: '2026-01-05',
        lines: [
          { account: code(contractCost), debit: 123 },
          { account: '1002', credit: 123 },
        ],
      });
      for (const project of [undefined, person.id, disabled.id, group.id, 999999]) {
        await expect(
          book.svc.vouchers.create({
            ...raw,
            lines: raw.lines.map((line, index) =>
              index === 0 ? { ...line, dimensions: project ? { project } : {} } : line,
            ),
          }),
        ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
      }
      const parentInput = await voucherInputFromSpec(book.svc, {
        date: '2026-01-05',
        lines: [
          { account: code(parent), debit: 123, dims: { project: 'A' } },
          { account: '1002', credit: 123 },
        ],
      });
      await expect(book.svc.vouchers.create(parentInput)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      const good = {
        ...raw,
        lines: raw.lines.map((line, index) =>
          index === 0 ? { ...line, dimensions: { project: valid.id } } : line,
        ),
      };
      await expect(
        book.svc.vouchers.create({
          ...good,
          lines: good.lines.map((line, index) => (index === 1 ? { ...line, credit: 122 } : line)),
        }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
      expect((await book.svc.vouchers.list({})).total).toBe(0);
      expect((await book.svc.vouchers.create(good)).number).toBe(1);
      if (enterprise) {
        const legacy = await voucherInputFromSpec(book.svc, {
          date: '2026-01-05',
          lines: [
            { account: '5401', debit: 123 },
            { account: '1002', credit: 123 },
          ],
        });
        await expect(book.svc.vouchers.create(legacy)).rejects.toMatchObject({
          data: { code: 'VOUCHER_INVALID' },
        });
      }
    } finally {
      await book.close();
    }
  });

  it('真实期初与采购/收入/结算/收款/成本结转后，可按合同核对余额并保持借贷平衡', async () => {
    const book = await setup(template, scheme);
    try {
      const project = await book.svc.dimensions.create({
        type: 'project',
        code: 'A',
        name: '合成施工合同A',
      });
      const cost = await book.svc.accounts.require(code(contractCost));
      const bank = await book.svc.accounts.require('1002');
      const capital = await book.svc.accounts.require(enterprise ? '4001' : '3001');
      await book.svc.opening.upsert({
        year: 2026,
        accountId: cost.id,
        dimensions: { project: project.id },
        balance: 10000,
      });
      await book.svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 90000 });
      await book.svc.opening.upsert({ year: 2026, accountId: capital.id, balance: -100000 });
      await expect(
        book.svc.opening.upsert({
          year: 2026,
          accountId: (await book.svc.accounts.require(code(parent))).id,
          balance: 1,
        }),
      ).rejects.toMatchObject({ data: { code: 'OPENING_NOT_LEAF' } });
      expect((await amountAt(book, code(contractCost), true))[0]).toMatchObject({
        opening: 10000,
        closing: 10000,
        dimensions: { project: project.id },
      });
      const lines = enterprise
        ? [
            [
              { account: code(contractCost), debit: 2000, dims: { project: 'A' } },
              { account: '1002', credit: 2000 },
            ],
            [
              { account: code('149002'), debit: 3000, dims: { project: 'A' } },
              { account: '6001', credit: 3000 },
            ],
            [
              { account: '1122', debit: 2500 },
              { account: code('149001'), credit: 2500, dims: { project: 'A' } },
            ],
            [
              { account: '6401', debit: 1000 },
              { account: code(contractCost), credit: 1000, dims: { project: 'A' } },
            ],
            [
              { account: '1002', debit: 2000 },
              { account: '1122', credit: 2000 },
            ],
          ]
        : [
            [
              { account: code(contractCost), debit: 2000, dims: { project: 'A' } },
              { account: '1002', credit: 2000 },
            ],
            [
              { account: code('440102'), debit: 300, dims: { project: 'A' } },
              { account: '1002', credit: 300 },
            ],
            [
              { account: code(contractCost), debit: 300, dims: { project: 'A' } },
              { account: code('440102'), credit: 300, dims: { project: 'A' } },
            ],
            [
              { account: '1122', debit: 3000 },
              { account: '5001', credit: 3000 },
            ],
            [
              { account: '5401', debit: 1000 },
              { account: code(contractCost), credit: 1000, dims: { project: 'A' } },
            ],
            [
              { account: '1002', debit: 2000 },
              { account: '1122', credit: 2000 },
            ],
          ];
      await seedVouchers(
        book.svc,
        lines.map((lines) => ({ date: '2026-01-05', lines, status: 'posted' })),
      );
      const costRows = await amountAt(book, code(contractCost), true);
      expect(costRows.find((row) => row.accountCode === code(contractCost))).toMatchObject({
        closing: enterprise ? 11000 : 11300,
        dimensions: { project: project.id },
      });
      expect((await amountAt(book, '1002'))[0]?.closing).toBe(enterprise ? 90000 : 89700);
      expect((await amountAt(book, '1122'))[0]?.closing).toBe(enterprise ? 500 : 1000);
      if (enterprise)
        expect(
          (await amountAt(book, '1490', true)).find((row) => row.accountCode === '1490'),
        ).toMatchObject({ closing: 500, dimensions: { project: project.id } });
      else
        expect((await amountAt(book, code('440102')))[0]).toMatchObject({
          debit: 300,
          credit: 300,
          closing: 0,
        });
      expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      expect((await book.svc.vouchers.list({})).total).toBe(lines.length);
    } finally {
      await book.close();
    }
  });
});

it('w_xt_kgzb_3：合同结算的借贷两侧按各合同分别保留，不能跨合同净额冒充报表资产', async () => {
  const template = constructionTemplates[0]!;
  const book = await setup(template, '4-2-2');
  try {
    for (const code of ['A', 'B'])
      await book.svc.dimensions.create({ type: 'project', code, name: `合成合同${code}` });
    await seedVouchers(book.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '149002', debit: 3000, dims: { project: 'A' } },
          { account: '6001', credit: 3000 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1122', debit: 2500 },
          { account: '149001', credit: 2500, dims: { project: 'A' } },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '149002', debit: 500, dims: { project: 'B' } },
          { account: '6001', credit: 500 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1122', debit: 1500 },
          { account: '149001', credit: 1500, dims: { project: 'B' } },
        ],
      },
    ]);
    const rows = (await amountAt(book, '1490', true)).filter((row) => row.accountCode === '1490');
    expect(rows.map((row) => row.closing).sort((a, b) => a - b)).toEqual([-1000, 500]);
    expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_3：整数分随机成本发生及冲回后，项目明细合计与总账相同（fast-check）', async () => {
  const book = await setup(constructionTemplates[0]!, '4-2-2');
  try {
    for (const code of ['A', 'B'])
      await book.svc.dimensions.create({ type: 'project', code, name: `合成合同${code}` });
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 2, maxLength: 6 }),
        async (amounts) => {
          const created = [];
          for (const [index, amount] of amounts.entries()) {
            const raw = await voucherInputFromSpec(book.svc, {
              date: '2026-01-05',
              lines: [
                { account: '1472', debit: amount, dims: { project: index % 2 ? 'B' : 'A' } },
                { account: '1002', credit: amount },
              ],
            });
            created.push(await book.svc.vouchers.create(raw));
          }
          const query = {
            periodFrom: 202601,
            periodTo: 202601,
            accountCodes: ['1472'],
            includeUnposted: true,
          };
          const grouped = await book.svc.ledger.balances({ ...query, groupBy: ['project'] });
          const total = (await book.svc.ledger.balances(query))[0]!.closing;
          expect(grouped.reduce((sum, row) => sum + row.closing, 0)).toBe(total);
          expect(BigInt(total)).toBe(amounts.reduce((sum, amount) => sum + BigInt(amount), 0n));
          for (const saved of created) await book.svc.vouchers.delete(saved.id);
          expect(await book.svc.ledger.balances(query)).toEqual([]);
        },
      ),
      { numRuns: 8 },
    );
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_3：事务后段插入失败不留下半张施工凭证，重试仍从1号保存', async () => {
  const book = await setup(constructionTemplates[1]!, '4-2-2');
  try {
    await book.svc.dimensions.create({ type: 'project', code: 'A', name: '合成施工合同' });
    const raw = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '440101', debit: 123, dims: { project: 'A' } },
        { account: '1002', credit: 123 },
      ],
    });
    book.book.raw.exec(
      "CREATE TRIGGER fail_construction_line BEFORE INSERT ON voucher_line WHEN NEW.line_no=2 BEGIN SELECT RAISE(ABORT,'construction-synthetic-last-line'); END",
    );
    await expect(book.svc.vouchers.create(raw)).rejects.toThrow(/construction-synthetic-last-line/);
    expect((await book.svc.vouchers.list({})).total).toBe(0);
    expect(await book.svc.db.selectFrom('voucher_line').selectAll().execute()).toEqual([]);
    book.book.raw.exec('DROP TRIGGER fail_construction_line');
    expect((await book.svc.vouchers.create(raw)).number).toBe(1);
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_a2：坏模板不能在真实建账前被接受', () => {
  const invalid = structuredClone(constructionTemplates[0]!);
  invalid.accounts.push(invalid.accounts[0]!);
  expect(() => parseTemplate(invalid)).toThrow(/重复/);
});
