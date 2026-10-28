import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestBook, seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser, type CoreServices } from '@caiwu/core/server';
import { PAWN_CODE_SCHEMES, PAWN_TEMPLATE_ID, buildPawnTemplate, type PawnCodeScheme } from '..';
import { getPawnBaseTemplate } from './base-fixture';

function mapped(native: string, scheme: PawnCodeScheme) {
  if (scheme === '4-2-2') return native;
  return (
    native.slice(0, 4) +
    (native.length > 4 ? native.slice(4, 6).padStart(3, '0') : '') +
    (native.length > 6 ? native.slice(6, 8).padStart(3, '0') : '')
  );
}

async function setup(scheme: PawnCodeScheme) {
  const t = await createTestBook({
    templates: [buildPawnTemplate(getPawnBaseTemplate())],
    templateId: PAWN_TEMPLATE_ID,
    codeScheme: scheme,
    seed: false,
  });
  const partner = await t.svc.dimensions.create({
    type: 'partner',
    code: 'SYN001',
    name: '合成当户一',
  });
  const project = await t.svc.dimensions.create({
    type: 'project',
    code: 'SYN-TICKET-001',
    name: '合成当票一',
  });
  return {
    t,
    partner,
    project,
    dims: { partner: partner.code, project: project.code },
    code: (native: string) => mapped(native, scheme),
  };
}

describe.each(PAWN_CODE_SCHEMES)('w_xt_kgzb_3 / w_acini_wizard 典当真实SQLite %s', (scheme) => {
  it('加载、末级辅助、期初、放款/息费/还款/存货类绝当处置、过账及重开余额一致', async () => {
    const { t, partner, project, dims, code } = await setup(scheme);
    const { svc } = t;
    try {
      const accounts = await svc.accounts.list();
      expect(accounts).toHaveLength(268);
      expect((await svc.book.info()).codeScheme).toEqual(
        scheme === '4-2-2' ? [4, 2, 2] : [4, 3, 3],
      );
      expect(
        t.book.raw.prepare('SELECT template_id,template_version FROM book_info').get(),
      ).toEqual({ template_id: PAWN_TEMPLATE_ID, template_version: '2026.10.28.1' });
      const principal = await svc.accounts.require(code('13030101'));
      expect(principal).toMatchObject({
        isLeaf: true,
        level: 3,
        direction: 'debit',
        isPartner: true,
      });
      expect((await svc.accounts.require('1303')).isLeaf).toBe(false);
      expect(principal.parentId).toBe((await svc.accounts.require(code('130301'))).id);
      expect((await svc.accounts.require(code('130401'))).isContra).toBe(true);
      expect((await svc.accounts.require(code('13030102'))).balanceNature).toBe('both');
      expect(await svc.opening.list(2026)).toEqual([]);
      expect((await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).length).toBe(0);
      const auxiliary = { partner: partner.id, project: project.id };
      for (const [native, balance] of [
        ['1002', 500000],
        ['13030101', 20000],
        ['130401', -1000],
        ['4001', -519000],
      ] as const) {
        await svc.opening.upsert({
          year: 2026,
          accountId: (await svc.accounts.require(code(native))).id,
          balance,
          dimensions: native.startsWith('130') ? auxiliary : {},
        });
      }
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      await seedVouchers(svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: code('13030101'), debit: 100000, dims },
            { account: '1002', credit: 100000 },
          ],
        },
        // 此合成交易假定已依法取得存货所有权且满足确认条件，不模拟逾期即转资产。
        {
          date: '2026-01-06',
          status: 'posted',
          lines: [
            { account: '1409', debit: 19000, dims: { project: project.code } },
            { account: code('130401'), debit: 1000, dims },
            { account: code('13030101'), credit: 20000, dims },
          ],
        },
        {
          date: '2026-01-06',
          status: 'posted',
          lines: [
            { account: '6701', debit: 1900 },
            { account: code('147101'), credit: 1900, dims: { project: project.code } },
          ],
        },
        {
          date: '2026-01-07',
          status: 'posted',
          lines: [
            { account: '1002', debit: 25000 },
            { account: '6051', credit: 25000 },
          ],
        },
        {
          date: '2026-01-07',
          status: 'posted',
          lines: [
            { account: '6402', debit: 17100 },
            { account: code('147101'), debit: 1900, dims: { project: project.code } },
            { account: '1409', credit: 19000, dims: { project: project.code } },
          ],
        },
        {
          date: '2026-01-08',
          status: 'posted',
          lines: [
            { account: '1002', debit: 1000 },
            { account: '2203', credit: 1000, dims },
          ],
        },
        {
          date: '2026-01-08',
          status: 'posted',
          lines: [
            { account: '2203', debit: 1000, dims },
            { account: code('13030102'), credit: 1000, dims },
          ],
        },
        // 合成金额只验证记账合成；实际利率/合同税费须另行计算。
        {
          date: '2026-01-09',
          status: 'posted',
          lines: [
            { account: code('13030102'), debit: 1000, dims },
            { account: '1132', debit: 2000, dims },
            { account: code('601101'), credit: 3000, dims },
          ],
        },
        {
          date: '2026-01-10',
          status: 'posted',
          lines: [
            { account: '1002', debit: 42000 },
            { account: '1132', credit: 2000, dims },
            { account: code('13030101'), credit: 40000, dims },
          ],
        },
        {
          date: '2026-01-11',
          status: 'posted',
          lines: [
            { account: '1002', debit: 500 },
            { account: '6021', credit: 500, dims: { partner: partner.code } },
          ],
        },
        {
          date: '2026-01-11',
          status: 'posted',
          lines: [
            { account: '6421', debit: 100 },
            { account: '1002', credit: 100 },
          ],
        },
        {
          date: '2026-01-12',
          status: 'posted',
          lines: [
            { account: '6702', debit: 200 },
            { account: code('130401'), credit: 200, dims },
          ],
        },
      ]);
      const balances = await svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        includeZero: true,
      });
      const expected = [
        ['1002', 468400],
        ['13030101', 60000],
        ['130301', 60000],
        ['1303', 60000],
        ['130401', -200],
        ['1304', -200],
        ['13030102', 0],
        ['1409', 0],
        ['147101', 0],
        ['1471', 0],
        ['1132', 0],
        ['2203', 0],
        ['601101', -3000],
        ['6011', -3000],
        ['6021', -500],
        ['6051', -25000],
        ['6402', 17100],
        ['6421', 100],
        ['6701', 1900],
        ['6702', 200],
        ['4001', -519000],
      ] as const;
      for (const [native, closing] of expected)
        expect(balances.find((a) => a.accountCode === code(native))?.closing, native).toBe(closing);
      const grouped = await svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: [code('13030101')],
        groupBy: ['partner', 'project'],
        rollup: false,
      });
      expect(grouped).toMatchObject([
        { closing: 60000, dimensions: { partner: partner.id, project: project.id } },
      ]);
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      const vouchers = await svc.vouchers.list({});
      expect(vouchers.items).toHaveLength(12);
      expect(vouchers.total).toBe(12);
      for (const account of accounts)
        expect((await svc.accounts.provenance(account.id)).sourceVersion).toBeTruthy();
      await t.store.close(t.info.id);
      const reopened = t.store.open(t.info.id);
      const again = createCoreServices({
        ...svc.ctx,
        db: reopened.db,
        user: (await loadServiceUser(reopened.db, 1))!,
      });
      expect(await again.accounts.list()).toEqual(accounts);
      expect(await again.vouchers.list({})).toEqual(vouchers);
      expect(
        await again.ledger.balances({ periodFrom: 202601, periodTo: 202601, includeZero: true }),
      ).toEqual(balances);
    } finally {
      await t.close();
    }
  });

  it('拒绝上级制证、缺辅助、错辅助类型、旧分类和不平衡凭证，不留下分录', async () => {
    const { t, partner, dims, code } = await setup(scheme);
    const { svc } = t;
    try {
      const input = async (
        account: string,
        debit: number,
        suppliedDims: Partial<typeof dims> | undefined,
      ) =>
        voucherInputFromSpec(svc, {
          date: '2026-01-05',
          lines: [
            { account, debit, dims: suppliedDims },
            { account: '1002', credit: 100 },
          ],
        });
      await expect(svc.vouchers.create(await input('1303', 100, undefined))).rejects.toThrow(
        /不是末级/,
      );
      await expect(
        svc.vouchers.create(await input(code('13030101'), 100, { partner: partner.code })),
      ).rejects.toThrow(/项目/);
      await expect(
        svc.vouchers.create(await input(code('13030101'), 100, { project: dims.project })),
      ).rejects.toThrow(/客户\/供应商/);
      await expect(svc.vouchers.create(await input(code('13030101'), 101, dims))).rejects.toThrow(
        /平衡/,
      );
      await expect(svc.vouchers.create(await input('1501', 100, undefined))).rejects.toThrow(
        /停用/,
      );
      const wrongType = await input(code('13030101'), 100, dims);
      wrongType.lines[0]!.dimensions.project = partner.id;
      await expect(svc.vouchers.create(wrongType)).rejects.toThrow(/项目|类型/);
      await expect(
        svc.opening.upsert({
          year: 2026,
          accountId: (await svc.accounts.require('1303')).id,
          balance: 100,
        }),
      ).rejects.toMatchObject({ data: { code: 'OPENING_NOT_LEAF' } });
      expect(await svc.vouchers.list({})).toEqual({ items: [], total: 0 });
      expect(await svc.opening.list(2026)).toEqual([]);
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    } finally {
      await t.close();
    }
  });
});

it('记账金额属性：任意整数分放款/还本后末级与父级余额一致、借贷守恒', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...PAWN_CODE_SCHEMES),
      fc.integer({ min: 1, max: 100000000 }),
      fc.nat({ max: 100000000 }),
      async (scheme, principal, repaymentSeed) => {
        const { t, dims, code } = await setup(scheme);
        try {
          await opening(t.svc, '1002', principal);
          await opening(t.svc, '4001', -principal);
          const repayment = repaymentSeed % (principal + 1);
          await seedVouchers(t.svc, [
            {
              date: '2026-01-05',
              status: 'posted',
              lines: [
                { account: code('13030101'), debit: principal, dims },
                { account: '1002', credit: principal },
              ],
            },
          ]);
          if (repayment > 0)
            await seedVouchers(t.svc, [
              {
                date: '2026-01-06',
                status: 'posted',
                lines: [
                  { account: '1002', debit: repayment },
                  { account: code('13030101'), credit: repayment, dims },
                ],
              },
            ]);
          const balances = await t.svc.ledger.balances({
            periodFrom: 202601,
            periodTo: 202601,
            includeZero: true,
          });
          expect(balances.find((a) => a.accountCode === code('13030101'))?.closing).toBe(
            principal - repayment,
          );
          expect(balances.find((a) => a.accountCode === '1303')?.closing).toBe(
            principal - repayment,
          );
          expect(balances.find((a) => a.accountCode === '1002')?.closing).toBe(repayment);
          expect((await t.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
        } finally {
          await t.close();
        }
      },
    ),
    { numRuns: 8 },
  );
});

async function opening(svc: CoreServices, code: string, balance: number) {
  await svc.opening.upsert({
    year: 2026,
    accountId: (await svc.accounts.require(code)).id,
    balance,
  });
}
