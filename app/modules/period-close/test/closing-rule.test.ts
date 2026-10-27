import { describe, expect, it } from 'vitest';
import { defineServerModule } from '@caiwu/server-kit';
import { createCoreServices } from '@caiwu/core/server';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import { mapTemplateScheme, parseCodeScheme, parseTemplate } from '@caiwu/core';
import server from '../server';
import manifest from '../manifest';
import { migrations } from '../server/migrations';
import { validateRule } from '../server/transfers';

// 独立合成期末前置；不import同波books模块，也不复制其248项生产科目。
const fixture = parseTemplate({
  schemaVersion: 1,
  id: 'enterprise-closing-test',
  version: '1',
  name: '合成企业结转',
  regime: 'enterprise',
  codeScheme: '4-2-2',
  categories: [
    { id: 'asset', name: '资产', direction: 'debit' },
    { id: 'equity', name: '权益', direction: 'credit' },
    { id: 'pnl', name: '损益', direction: 'credit', isPnl: true },
  ],
  accounts: [
    { code: '1001', name: '合成资金', category: 'asset' },
    { code: '4103', name: '本年利润', category: 'equity', closingRule: 'year-retained-earnings' },
    { code: '4104', name: '利润分配', category: 'equity' },
    {
      code: '6001',
      name: '主营业务收入',
      category: 'pnl',
      closingRule: 'profit',
      source: '故意不作为语义依据：转未分配利润',
    },
    {
      code: '6901',
      name: '以前年度损益调整',
      category: 'pnl',
      closingRule: 'retained-earnings',
      source: '故意不作为语义依据：转本年利润',
    },
  ],
  voucherTypes: [{ code: '记', name: '记账凭证' }],
});
const registered = defineServerModule(manifest, {
  router: server.router,
  migrations,
  templates: [fixture],
});

describe.each(['4-2-2', '4-3-3'])('w_zw_ydjz_1 6901实际生成：%s', (scheme) => {
  it.each([
    { adjustment: 20000, detail: false },
    { adjustment: -20000, detail: false },
    { adjustment: 20000, detail: true },
    { adjustment: -20000, detail: true },
  ])(
    '调整$adjustment分、明细$detail不混入本年利润；显式转利润分配正确',
    async ({ adjustment, detail }) => {
      const mod = defineServerModule(manifest, {
        router: server.router,
        migrations,
        templates: [mapTemplateScheme(fixture, parseCodeScheme(scheme))],
      });
      const app = await createTestApp({ modules: [mod], templateId: fixture.id, seed: false });
      try {
        const svc = app.svc;
        // 新增6901明细必须继承用途；两种段长都不会从明细退回普通损益。
        const adjustmentCode = detail ? (scheme === '4-2-2' ? '690101' : '6901001') : '6901';
        const account = detail
          ? await svc.accounts.create(
              { code: adjustmentCode, name: '调整明细' },
              parseCodeScheme(scheme),
            )
          : await svc.accounts.require('6901');
        const aid = async (code: string) => (await svc.accounts.require(code)).id;
        await svc.opening.upsert({ year: 2026, accountId: await aid('1001'), balance: 0 });
        await seedVouchers(svc, [
          {
            date: '2026-01-02',
            status: 'posted',
            lines: [
              { account: '1001', debit: 100000 },
              { account: '6001', credit: 100000 },
            ],
          },
          {
            date: '2026-01-03',
            status: 'posted',
            lines:
              adjustment > 0
                ? [
                    { account: '1001', debit: adjustment },
                    { account: adjustmentCode, credit: adjustment },
                  ]
                : [
                    { account: adjustmentCode, debit: -adjustment },
                    { account: '1001', credit: -adjustment },
                  ],
          },
        ]);
        expect(account.closingRule).toBe('retained-earnings');
        expect((await svc.accounts.require('6901')).categoryId).toBe('pnl');
        const actual = app.call(mod);
        const base = {
          code: 'PNL',
          name: '普通损益',
          kind: 'pnl' as const,
          voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
          summary: '结转本期损益',
          order: 1,
          enabled: true,
          targetAccountId: await aid('4103'),
          sources: [],
        };
        expect((await validateRule(svc, base)).sourceIds).not.toContain(account.id);
        await actual.saveRule({ data: base });
        await actual.saveRule({
          data: {
            ...base,
            code: 'ADJUSTMENT',
            name: '以前年度调整转未分配利润',
            kind: 'custom',
            order: 2,
            targetAccountId: await aid('4104'),
            sources: [{ accountId: await aid('6901'), mode: 'balance', ratio: '100' }],
          },
        });
        const ruleIds = (await actual.rules()).map((rule) => rule.id);
        const preview = await actual.preview({ period: 202601, ruleIds });
        const accounts = await svc.accounts.list();
        const lines = (index: number) =>
          preview.items[index]!.lines.map((line) => ({
            code: accounts.find((a) => a.id === line.accountId)!.code,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
          }));
        expect(lines(0)).toEqual([
          { code: '6001', debit: 100000, credit: 0 },
          { code: '4103', debit: 0, credit: 100000 },
        ]);
        expect(lines(1)).toEqual(
          adjustment > 0
            ? [
                { code: adjustmentCode, debit: adjustment, credit: 0 },
                { code: '4104', debit: 0, credit: adjustment },
              ]
            : [
                { code: adjustmentCode, debit: 0, credit: -adjustment },
                { code: '4104', debit: -adjustment, credit: 0 },
              ],
        );
        if (!detail && adjustment > 0) {
          const raw = app.runtime.bookStore.open(app.book.id).raw;
          raw.exec(`CREATE TEMP TRIGGER fail_adjustment BEFORE INSERT ON voucher
          WHEN NEW.source_module='period-close' AND NEW.source_id='202601:${ruleIds[1]}'
          BEGIN SELECT RAISE(ABORT,'synthetic second transfer failure'); END;`);
          try {
            await expect(
              actual.generate({
                period: 202601,
                ruleIds,
                confirmed: true,
                previewToken: preview.previewToken,
              }),
            ).rejects.toThrow(/synthetic second transfer failure/);
            expect((await svc.vouchers.list({})).total).toBe(2);
          } finally {
            raw.exec('DROP TRIGGER fail_adjustment');
          }
        }
        const generated = await actual.generate({
          period: 202601,
          ruleIds,
          confirmed: true,
          previewToken: preview.previewToken,
        });
        expect(generated.generated).toHaveLength(2);
        for (const [index, row] of generated.generated.entries()) {
          const voucher = await svc.vouchers.get(row.id);
          expect(voucher!.number).toBe(3 + index);
          expect(
            voucher!.lines.map((line) => ({
              code: accounts.find((a) => a.id === line.accountId)!.code,
              debit: line.debit,
              credit: line.credit,
            })),
          ).toEqual(lines(index));
        }
        const pending = await svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          includeUnposted: true,
        });
        expect(pending.find((r) => r.accountCode === '4103')?.closing).toBe(-100000);
        expect(pending.find((r) => r.accountCode === '4104')?.closing).toBe(-adjustment);
        expect(pending.find((r) => r.accountCode === adjustmentCode)?.closing).toBe(0);
        expect(
          (await svc.ledger.trialBalance(202601, 202601, { includeUnposted: true })).balanced,
        ).toBe(true);
        expect(
          (
            await actual.generate({
              period: 202601,
              ruleIds,
              confirmed: true,
              previewToken: preview.previewToken,
            })
          ).generated.every((row) => row.existing),
        ).toBe(true);
        expect((await svc.vouchers.list({})).total).toBe(4);
        const reviewer = createCoreServices({
          ...svc.ctx,
          user: await svc.users.create({
            code: 'closing-reviewer',
            name: '合成审核员',
            password: '',
            permissions: [],
          }),
        });
        await reviewer.vouchers.changeStatus({
          ids: generated.generated.map((row) => row.id),
          to: 'audited',
        });
        await actual.post({ from: 202601, to: 202601 });
        const posted = await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
        expect(posted.find((row) => row.accountCode === '4103')?.closing).toBe(-100000);
        expect(posted.find((row) => row.accountCode === '4104')?.closing).toBe(-adjustment);
        expect(posted.find((row) => row.accountCode === adjustmentCode)?.closing).toBe(0);
        expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      } finally {
        await app.close();
      }
    },
  );
});

it('旧账空结转语义按原类别兼容，不按编码、名称或source猜测/回填', async () => {
  const app = await createTestApp({ modules: [registered], seed: false });
  try {
    const source = await app.svc.accounts.create(
      {
        code: '6901',
        name: '以前年度损益调整',
        categoryId: 'pnl',
        source: '结转未分配利润后无余额',
      },
      parseCodeScheme('4-2-2'),
    );
    const rule = {
      code: 'LEGACY',
      name: '旧账损益',
      kind: 'pnl' as const,
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '旧账规则',
      order: 1,
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('4103')).id,
      sources: [],
    };
    expect(source.closingRule).toBeNull();
    expect((await validateRule(app.svc, rule)).sourceIds).toContain(source.id);
    expect((await app.svc.accounts.require(source.id)).closingRule).toBeNull();
  } finally {
    await app.close();
  }
});
