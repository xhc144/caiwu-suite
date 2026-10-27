import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestApp, createTestBook, seedVouchers } from '@caiwu/testkit';
import { parseTemplate } from '@caiwu/core';
import booksServer from '../server';
import { enterpriseChart } from '../chart';
import { expectedEnterprise } from './expected-enterprise';
import { expectedEnterpriseUpdates } from './expected-enterprise-updates';
import legacy from './fixtures/enterprise-review.json';

const independentPrimary = [
  ...expectedEnterprise.map(([code, name, category, direction, contra]) => [
    code,
    code === '6403' ? '税金及附加' : name,
    category,
    direction,
    contra,
  ]),
  ...expectedEnterpriseUpdates.map((row) => row.slice(0, 5)),
].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb_3 / w_login 企业完整SQLite：%s', (scheme) => {
  it('原子建账、登录、248科目及来源语义持久化，明细正式记账、上级汇总和重开一致', async () => {
    const app = await createTestApp({ modules: [booksServer], seed: false });
    try {
      const input = {
        name: '合成企业完整账',
        orgName: '合成企业单位',
        templateId: enterpriseChart.id,
        product: 'qingsong' as const,
        startYear: 2026,
        startMonth: 1,
        codeScheme: scheme,
        adminPassword: 'synthetic-pass',
        requestKey: `enterprise-${scheme}-same-request`,
      };
      const [book, repeated] = await Promise.all([
        app.core(null).books.create(input),
        app.core(null).books.create(input),
      ]);
      expect(repeated.id).toBe(book.id);
      const { token } = await app
        .core(null)
        .auth.login({ bookId: book.id, userCode: 'admin', password: 'synthetic-pass' });
      const accountRows = await app.core(token).accounts.list();
      expect(accountRows).toHaveLength(248);
      expect(
        accountRows
          .filter((a) => a.code.length === 4)
          .map((a) => [a.code, a.name, a.categoryId, a.direction, a.isContra]),
      ).toEqual(independentPrimary);
      const opened = app.runtime.bookStore.open(book.id);
      expect(
        opened.raw.prepare('SELECT template_id,template_version FROM book_info').get(),
      ).toEqual({ template_id: enterpriseChart.id, template_version: '2006.18+2026.2' });
      const svc = createCoreServices({
        db: opened.db,
        user: (await loadServiceUser(opened.db, 1))!,
        moduleId: null,
        now: app.runtime.now,
        modules: app.runtime.modules.lookup,
        providers: app.runtime.modules.providers,
      });
      for (const account of accountRows) {
        const provenance = await svc.accounts.provenance(account.id);
        expect(provenance.source).toBeTruthy();
        expect(provenance.sourceVersion).toBeTruthy();
      }
      expect(await svc.accounts.provenance((await svc.accounts.require('5402')).id)).toMatchObject({
        isContra: true,
        balanceNature: 'credit',
        source: expect.stringContaining('第三项完工对冲工程施工'),
      });
      expect((await svc.accounts.require('3001')).balanceNature).toBe('both');
      expect((await svc.accounts.require('6001')).balanceNature).toBe('no-closing-balance');
      expect(await svc.accounts.provenance((await svc.accounts.require('6901')).id)).toMatchObject({
        closingRule: 'retained-earnings',
      });
      expect((await svc.accounts.require('6001')).closingRule).toBe('profit');
      const salary = scheme === '4-2-2' ? '221101' : '2211001';
      const vat = scheme === '4-2-2' ? '22210101' : '2221001001';
      expect((await svc.accounts.require(vat)).parentId).toBe(
        (await svc.accounts.require(scheme === '4-2-2' ? '222101' : '2221001')).id,
      );
      await seedVouchers(svc, [
        {
          date: '2026-01-05',
          status: 'posted',
          lines: [
            { account: '6602', debit: 12345 },
            { account: salary, credit: 12345 },
          ],
        },
        {
          date: '2026-01-06',
          status: 'posted',
          lines: [
            { account: vat, debit: 1299 },
            { account: '1002', credit: 1299 },
          ],
        },
      ]);
      const balances = await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
      for (const [code, amount] of [
        [salary, -12345],
        ['2211', -12345],
        [vat, 1299],
        ['2221', 1299],
        ['6602', 12345],
        ['1002', -1299],
      ] as const)
        expect(balances.find((row) => row.accountCode === code)?.closing).toBe(amount);
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      const vouchers = await svc.vouchers.list({});
      await app.core(token).auth.logout();
      await app.runtime.bookStore.close(book.id);
      const login = await app
        .core(null)
        .auth.login({ bookId: book.id, userCode: 'admin', password: 'synthetic-pass' });
      expect(await app.core(login.token).accounts.list()).toEqual(accountRows);
      const reopened = app.runtime.bookStore.open(book.id);
      const again = createCoreServices({
        ...svc.ctx,
        db: reopened.db,
        user: (await loadServiceUser(reopened.db, 1))!,
      });
      expect(await again.vouchers.list({})).toEqual(vouchers);
      expect(await again.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).toEqual(
        balances,
      );
      expect((await app.core(null).books.create(input)).id).toBe(book.id);
    } finally {
      await app.close();
    }
  });
});

it('w_xt_kgzb_3 完整企业中途约束失败清理；原九项已有凭证、期初和余额重开不自动补改', async () => {
  const book = await createTestBook({
    templates: [legacy, enterpriseChart],
    templateId: legacy.id,
    seed: false,
  });
  try {
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('1002')).id,
      balance: 8007,
    });
    await book.svc.opening.upsert({
      year: 2026,
      accountId: (await book.svc.accounts.require('4001')).id,
      balance: -8007,
    });
    await seedVouchers(book.svc, [
      {
        date: '2026-01-03',
        status: 'posted',
        lines: [
          { account: '1002', debit: 101 },
          { account: '4001', credit: 101 },
        ],
      },
    ]);
    const before = {
      accounts: await book.svc.accounts.list(),
      info: await book.svc.book.info(),
      vouchers: await book.svc.vouchers.list({}),
      opening: await book.svc.opening.list(2026),
      balances: await book.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
      log: await book.svc.log.list(),
    };
    const broken = parseTemplate({
      ...enterpriseChart,
      id: 'enterprise-rollback-fixture',
      accounts: enterpriseChart.accounts.map((a) =>
        a.code === '1485'
          ? {
              ...a,
              dimensions: [
                { type: 'partner', required: true },
                { type: 'partner', required: true },
              ],
            }
          : a,
      ),
    });
    book.templates.register('broken', [broken]);
    const files = readdirSync(book.store.booksDir).sort();
    await expect(
      book.store.create({
        name: '约束失败',
        orgName: '合成单位',
        templateId: broken.id,
        product: 'qingsong',
        startYear: 2026,
        startMonth: 1,
      }),
    ).rejects.toThrow(/UNIQUE/);
    expect(readdirSync(book.store.booksDir).sort()).toEqual(files);
    await book.store.create({
      name: '正确新账',
      orgName: '合成单位',
      templateId: enterpriseChart.id,
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
    });
    await book.store.close(book.info.id);
    const opened = book.store.open(book.info.id);
    const svc = createCoreServices({
      ...book.svc.ctx,
      db: opened.db,
      user: (await loadServiceUser(opened.db, 1))!,
    });
    expect({
      accounts: await svc.accounts.list(),
      info: await svc.book.info(),
      vouchers: await svc.vouchers.list({}),
      opening: await svc.opening.list(2026),
      balances: await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
      log: await svc.log.list(),
    }).toEqual(before);
    expect((await svc.accounts.list()).length).toBe(9);
  } finally {
    await book.close();
  }
});
