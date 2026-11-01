import { describe, expect, it } from 'vitest';
import { defineManifest, mapTemplateScheme, parseCodeScheme, parseTemplate } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import server from '../server';
import enterprise from '../supplements/construction/test/fixtures/enterprise-2026.json';
import small from '../supplements/construction/test/fixtures/small-business-2013.json';

const baseManifest = defineManifest({
  id: 'industry-integration-base',
  name: '合成验证基表',
  products: 'all',
});
const bases = defineServerModule(baseManifest, {
  router: moduleKit(baseManifest).router({}),
  templates: [enterprise, small],
});
const cases = [
  { id: 'construction-cas-revenue-2017', code: '149001' },
  { id: 'construction-small-business-2013', code: '440101' },
  { id: 'pawn-enterprise-cas-2021', code: '1409' },
  { id: 'enterprise-infrastructure-cas', code: '160401' },
  { id: 'real-estate-enterprise', code: '500101' },
  { id: 'financing-guarantee-cas22-2026', code: '280101' },
  { id: 'financing-guarantee-cas25-2026', code: '2603' },
  { id: 'microloan-enterprise-cas22-2026', code: '130301' },
];

describe.each(cases)('w_xt_kgzb_3：$id 统一登记建账', ({ id, code }) => {
  it('两种级次、合法期初、真实对象制证、重开与原账隔离', async () => {
    const app = await createTestApp({
      modules: [bases, server],
      templateId: enterprise.id,
      seed: false,
    });
    try {
      const original = await app.core().accounts.list();
      const template = app.runtime.templates.get(id);
      for (const scheme of ['4-2-2', '4-3-3']) {
        const book = await app.core().books.create({
          name: `行业合成${id}${scheme}`,
          orgName: '合成单位',
          templateId: id,
          codeScheme: scheme,
          product: 'chengben',
          startYear: 2026,
          startMonth: 1,
          adminPassword: 'admin',
          facts: id.startsWith('financing-guarantee-')
            ? {
                guaranteeStandard: id.includes('cas25') ? 'cas25' : 'cas22',
                financialGuaranteeContract: true,
                designatedAtFairValue: false,
                ...(id.includes('cas25')
                  ? {
                      previouslyAssertedInsurance: true,
                      usedInsuranceAccounting: true,
                      irrevocableContractElection: true,
                    }
                  : {}),
              }
            : undefined,
        });
        const { token } = await app
          .core(null)
          .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
        const rows = await app.core(token).accounts.list();
        const mapped = mapTemplateScheme(template, parseCodeScheme(scheme));
        expect(rows.map((a) => [a.code, a.name])).toEqual(
          [...mapped.accounts]
            .sort((a, b) => a.code.localeCompare(b.code))
            .map((a) => [a.code, a.name]),
        );
        const leafCode = mapTemplateScheme(
          parseTemplate({
            ...template,
            accounts: template.accounts.filter((a) => a.code === code || code.startsWith(a.code)),
          }),
          parseCodeScheme(scheme),
        ).accounts.find(
          (a) => a.name === template.accounts.find((a) => a.code === code)!.name,
        )!.code;
        const leaf = rows.find((a) => a.code === leafCode)!;
        expect(leaf.isLeaf).toBe(true);
        const opened = app.runtime.bookStore.open(book.id);
        const svc = createCoreServices({
          db: opened.db,
          user: (await loadServiceUser(opened.db, 1))!,
          moduleId: null,
          modules: app.runtime.modules.lookup,
          now: app.runtime.now,
        });
        const bank = rows.find((a) => a.code === '1002')!;
        const equity = rows.find(
          (a) => a.categoryId === 'equity' && a.isLeaf && !a.disabled && !a.dimensions.length,
        )!;
        await svc.opening.upsert({ year: 2026, accountId: bank.id, balance: 100_00 });
        await svc.opening.upsert({ year: 2026, accountId: equity.id, balance: -100_00 });
        expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
        const dimensions: Record<string, number> = {};
        for (const d of leaf.dimensions)
          dimensions[d.type] = (
            await svc.dimensions.create({ type: d.type, code: 'TEST', name: '合成真实对象' })
          ).id;
        const raw = await voucherInputFromSpec(svc, {
          date: '2026-01-05',
          lines: [
            { account: leaf.code, debit: 12_34 },
            { account: '1002', credit: 12_34 },
          ],
        });
        if (leaf.dimensions.some((d) => d.required))
          await expect(svc.vouchers.create(raw)).rejects.toMatchObject({
            data: { code: 'VOUCHER_INVALID' },
          });
        const saved = await svc.vouchers.create({
          ...raw,
          lines: raw.lines.map((line, i) => (i === 0 ? { ...line, dimensions } : line)),
        });
        await svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
        await svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
        expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
        const opening = await svc.opening.list(2026);
        expect(opening).toHaveLength(2);
        await app.runtime.bookStore.close(book.id);
        expect(await app.core(token).accounts.list()).toEqual(rows);
        const reopened = app.runtime.bookStore.open(book.id);
        const reopenedSvc = createCoreServices({
          db: reopened.db,
          user: (await loadServiceUser(reopened.db, 1))!,
          moduleId: null,
          modules: app.runtime.modules.lookup,
          now: app.runtime.now,
        });
        expect(await reopenedSvc.opening.list(2026)).toEqual(opening);
        expect(await app.core().accounts.list()).toEqual(original);
      }
    } finally {
      await app.close();
    }
  });
});

it('w_xt_kgzb_a2：地方党费仅deprecated参考，历史及政府基建子集不注册', async () => {
  const app = await createTestApp({
    modules: [bases, server],
    templateId: enterprise.id,
    seed: false,
  });
  try {
    const list = await app.core().books.templates();
    expect(list.find((t) => t.id === 'party-dues-jining-port-2021')).toMatchObject({
      status: 'deprecated',
    });
    expect(list.some((t) => /1996|1998/.test(t.id))).toBe(false);
    expect(
      list.some((t) => /government.*infrastructure|infrastructure.*government/.test(t.id)),
    ).toBe(false);
    for (const { id } of cases) expect(list.find((t) => t.id === id)?.status).toBe('current');
  } finally {
    await app.close();
  }
});
