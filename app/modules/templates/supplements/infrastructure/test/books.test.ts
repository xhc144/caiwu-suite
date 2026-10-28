import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { parseCodeScheme } from '@caiwu/core';
import {
  assertInfrastructureHistoricalPeriod,
  buildEnterpriseInfrastructureTemplate,
  infrastructureHistoricalTemplates,
  stateOwnedConstruction1996Template,
  stateOwnedConstruction1998Template,
} from '../index';
import { readEnterpriseBase } from './base';

describe.each(['3-2-2', '3-3-3'])('w_xt_kgzb_3：1998历史基建 %s', (scheme) => {
  it('真实建账、父链、期初、分项投资/供应商制证和过账余额', async () => {
    const template = stateOwnedConstruction1998Template;
    assertInfrastructureHistoricalPeriod(template.id, 2000);
    const t = await createTestBook({
      templates: [template],
      templateId: template.id,
      codeScheme: scheme,
      startYear: 2000,
      seed: false,
    });
    const detail = (parent: string, suffix: string) =>
      parent + suffix.padStart(scheme === '3-2-2' ? 2 : 3, '0');
    try {
      const root = await t.svc.dimensions.create({
        type: 'project',
        code: 'P',
        name: '合成项目组',
      });
      const project = await t.svc.dimensions.create({
        type: 'project',
        code: 'P01',
        name: '合成单位工程',
        parentId: root.id,
      });
      const party = await t.svc.dimensions.create({
        type: 'partner',
        code: 'S01',
        name: '合成施工单位',
      });
      const rows = await t.svc.accounts.list();
      expect(rows).toHaveLength(template.accounts.length);
      expect(await t.svc.book.info()).toMatchObject({
        templateId: template.id,
        codeScheme: parseCodeScheme(scheme),
        startPeriod: 200001,
      });
      const investment = await t.svc.accounts.require(detail('101', '1'));
      const grants = await t.svc.accounts.require(detail('301', '2'));
      const bank = await t.svc.accounts.require('232');
      expect(investment).toMatchObject({
        parentId: (await t.svc.accounts.require('101')).id,
        isLeaf: true,
        direction: 'debit',
      });
      expect(await t.svc.accounts.require('202')).toMatchObject({
        direction: 'credit',
        isContra: true,
      });
      expect(await t.svc.accounts.provenance(investment.id)).toMatchObject({
        sourceVersion: '财会字〔1995〕45号（1996原始版）',
      });
      await t.svc.tx(async (svc) => {
        await svc.opening.upsert({ year: 2000, accountId: bank.id, balance: 1_000_00 });
        await svc.opening.upsert({
          year: 2000,
          accountId: grants.id,
          dimensions: { project: project.id },
          balance: -1_000_00,
        });
      });
      expect((await t.svc.ledger.trialBalance(200001, 200001)).balanced).toBe(true);
      await expect(
        t.svc.opening.upsert({
          year: 2000,
          accountId: (await t.svc.accounts.require('101')).id,
          balance: 1,
        }),
      ).rejects.toMatchObject({ data: { code: 'OPENING_NOT_LEAF' } });
      await seedVouchers(t.svc, [
        {
          date: '2000-01-05',
          status: 'posted',
          lines: [
            { account: detail('101', '1'), debit: 300_00, dims: { project: 'P01' } },
            { account: '332', credit: 300_00, dims: { partner: 'S01' } },
          ],
        },
        {
          date: '2000-01-06',
          status: 'posted',
          lines: [
            { account: '332', debit: 200_00, dims: { partner: 'S01' } },
            { account: '232', credit: 200_00 },
          ],
        },
      ]);
      const query = { periodFrom: 200001, periodTo: 200001 };
      expect(
        await t.svc.ledger.balances({
          ...query,
          accountCodes: [investment.code],
          groupBy: ['project'],
        }),
      ).toContainEqual(
        expect.objectContaining({
          closing: 300_00,
          dimensions: expect.objectContaining({ project: project.id }),
        }),
      );
      expect(
        await t.svc.ledger.balances({ ...query, accountCodes: ['332'], groupBy: ['partner'] }),
      ).toContainEqual(
        expect.objectContaining({
          closing: -100_00,
          dimensions: expect.objectContaining({ partner: party.id }),
        }),
      );
      expect(await t.svc.ledger.balances({ ...query, accountCodes: ['232'] })).toContainEqual(
        expect.objectContaining({ opening: 1_000_00, closing: 800_00 }),
      );
      expect(await t.svc.ledger.trialBalance(200001, 200001)).toMatchObject({
        balanced: true,
        openingDebit: 1_000_00,
        openingCredit: 1_000_00,
        debit: 500_00,
        credit: 500_00,
      });
    } finally {
      await t.close();
    }
  });
});

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb_3：企业基建 %s', (scheme) => {
  it('完整基表合成建账、末级制证、项目必填与转固后试算平衡', async () => {
    // Pass native template to BookStore, which maps the chosen scheme exactly once.
    const template = buildEnterpriseInfrastructureTemplate(readEnterpriseBase());
    const t = await createTestBook({
      templates: [template],
      templateId: template.id,
      codeScheme: scheme,
      seed: false,
    });
    const construction = scheme === '4-2-2' ? '160401' : '1604001';
    try {
      const project = await t.svc.dimensions.create({
        type: 'project',
        code: 'P01',
        name: '合成项目',
      });
      expect((await t.svc.accounts.list()).length).toBe(template.accounts.length);
      expect(await t.svc.accounts.require(construction)).toMatchObject({
        isLeaf: true,
        direction: 'debit',
        parentId: (await t.svc.accounts.require('1604')).id,
        dimensions: [{ type: 'project', required: true, defaultItemId: null }],
      });
      const bank = await t.svc.accounts.require('1002');
      const capital = await t.svc.accounts.require('4001');
      await t.svc.tx(async (svc) => {
        await svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 10_000_00 });
        await svc.opening.upsert({ year: 2026, accountId: capital.id, balance: -10_000_00 });
      });
      const raw = await voucherInputFromSpec(t.svc, {
        date: '2026-01-05',
        lines: [
          { account: construction, debit: 200_00 },
          { account: '1002', credit: 200_00 },
        ],
      });
      await expect(t.svc.vouchers.create(raw)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      const parentId = (await t.svc.accounts.require('1604')).id;
      const parentRaw = {
        ...raw,
        lines: raw.lines.map((line, i) =>
          i === 0 ? { ...line, accountId: parentId, dimensions: { project: project.id } } : line,
        ),
      };
      await expect(t.svc.vouchers.create(parentRaw)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      const valid = {
        ...raw,
        lines: raw.lines.map((line, i) =>
          i === 0 ? { ...line, dimensions: { project: project.id } } : line,
        ),
      };
      await expect(
        t.svc.vouchers.create({
          ...valid,
          lines: valid.lines.map((line, i) => (i === 1 ? { ...line, credit: 199_99 } : line)),
        }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
      expect((await t.svc.vouchers.list({})).total).toBe(0);
      const paid = await t.svc.vouchers.create(valid);
      await t.svc.vouchers.changeStatus({ ids: [paid.id], to: 'audited' });
      await t.svc.vouchers.changeStatus({ ids: [paid.id], to: 'posted' });
      await seedVouchers(t.svc, [
        {
          date: '2026-01-06',
          status: 'posted',
          lines: [
            { account: '1601', debit: 200_00 },
            { account: construction, credit: 200_00, dims: { project: 'P01' } },
          ],
        },
      ]);
      expect(await t.svc.ledger.trialBalance(202601, 202601)).toMatchObject({
        balanced: true,
        openingDebit: 10_000_00,
        openingCredit: 10_000_00,
        debit: 400_00,
        credit: 400_00,
      });
      expect(
        await t.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: [construction],
        }),
      ).toContainEqual(expect.objectContaining({ closing: 0 }));
      expect(
        await t.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['1601'],
        }),
      ).toContainEqual(expect.objectContaining({ closing: 200_00 }));
    } finally {
      await t.close();
    }
  });
});

it('w_xt_kgzb_3：项目/往来不能用错误类型、停用、非末级或不存在档案', async () => {
  const template = stateOwnedConstruction1998Template;
  const t = await createTestBook({
    templates: [template],
    templateId: template.id,
    startYear: 2000,
    seed: false,
  });
  try {
    const projectParent = await t.svc.dimensions.create({
      type: 'project',
      code: 'P',
      name: '项目组',
    });
    const project = await t.svc.dimensions.create({
      type: 'project',
      code: 'P01',
      name: '单位工程',
      parentId: projectParent.id,
    });
    const disabled = await t.svc.dimensions.create({
      type: 'project',
      code: 'P00',
      name: '停用工程',
      disabled: true,
    });
    const party = await t.svc.dimensions.create({ type: 'partner', code: 'S01', name: '施工单位' });
    const raw = await voucherInputFromSpec(t.svc, {
      date: '2000-01-05',
      lines: [
        { account: '10101', debit: 100_00, dims: { project: 'P01' } },
        { account: '332', credit: 100_00, dims: { partner: 'S01' } },
      ],
    });
    for (const id of [projectParent.id, disabled.id, party.id, 999999]) {
      await expect(
        t.svc.vouchers.create({
          ...raw,
          lines: raw.lines.map((line, i) =>
            i === 0 ? { ...line, dimensions: { project: id } } : line,
          ),
        }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    }
    await expect(
      t.svc.vouchers.create({
        ...raw,
        lines: raw.lines.map((line, i) =>
          i === 1 ? { ...line, dimensions: { partner: project.id } } : line,
        ),
      }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    expect((await t.svc.vouchers.list({})).total).toBe(0);
  } finally {
    await t.close();
  }
});

it('w_xt_kgzb_3：随机整数分在项目维度、科目及试算中一致（fast-check）', async () => {
  const template = buildEnterpriseInfrastructureTemplate(readEnterpriseBase());
  const t = await createTestBook({ templates: [template], templateId: template.id, seed: false });
  try {
    for (const code of ['A', 'B'])
      await t.svc.dimensions.create({ type: 'project', code, name: `合成工程${code}` });
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 6 }),
        async (amounts) => {
          const ids: number[] = [];
          try {
            for (const [i, amount] of amounts.entries()) {
              const raw = await voucherInputFromSpec(t.svc, {
                date: '2026-01-05',
                lines: [
                  { account: '160401', debit: amount, dims: { project: i % 2 ? 'B' : 'A' } },
                  { account: '1002', credit: amount },
                ],
              });
              ids.push((await t.svc.vouchers.create(raw)).id);
            }
            const query = {
              periodFrom: 202601,
              periodTo: 202601,
              accountCodes: ['160401'],
              includeUnposted: true,
            };
            const grouped = await t.svc.ledger.balances({ ...query, groupBy: ['project'] });
            const total = amounts.reduce((s, n) => s + BigInt(n), 0n);
            expect(grouped.reduce((s, row) => s + BigInt(row.closing), 0n)).toBe(total);
            expect(await t.svc.ledger.balances(query)).toContainEqual(
              expect.objectContaining({ closing: Number(total) }),
            );
            expect(
              (await t.svc.ledger.trialBalance(202601, 202601, { includeUnposted: true })).balanced,
            ).toBe(true);
          } finally {
            for (const id of ids) await t.svc.vouchers.delete(id);
          }
        },
      ),
      { numRuns: 12 },
    );
  } finally {
    await t.close();
  }
});

it('w_xt_kgzb_a5：1996—1997定义可核对，但core年份下限2000阻止真实历史建账', async () => {
  const t = await createTestBook({
    templates: [...infrastructureHistoricalTemplates],
    seed: false,
  });
  try {
    const before = readdirSync(t.store.booksDir).sort();
    await expect(
      t.store.create({
        name: '1997历史合成账',
        orgName: '合成建设单位',
        templateId: stateOwnedConstruction1996Template.id,
        product: 'chengben',
        startYear: 1997,
        startMonth: 1,
        adminPassword: 'test',
      }),
    ).rejects.toThrow();
    expect(readdirSync(t.store.booksDir).sort()).toEqual(before);
  } finally {
    await t.close();
  }
});
