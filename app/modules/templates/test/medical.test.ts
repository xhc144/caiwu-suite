import { expect, it } from 'vitest';
import { mapTemplateScheme, parseCodeScheme, templateProblems } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import { residentMedicalTemplate as template } from '../supplements/medical';
import server from '../server';
import { integrationModules } from './template-fixtures';

// 独立抄录财会〔2017〕28号PDF第6—8页，不从被测groups变量生成。
const primary = `1001库存现金 1002收入户存款 1003财政专户存款 1004支出户存款 1005国库存款 1101暂付款 1201债券投资 1202委托投资 2001暂收款 2101借入款项 3001一般基金结余 3101风险基金结余 3201储备金结余 4001社会保险费收入 4101财政补贴收入 4102集体补助收入 4201利息收入 4202委托投资收益 4301转移收入 4401上级补助收入 4402下级上解收入 4501其他收入 4601待转社会保险费收入 4602待转利息收入 5001社会保险待遇支出 5101大病保险支出 5102劳动能力鉴定支出 5103工伤预防费用支出 5104稳定岗位补贴支出 5105技能提升补贴支出 5201转移支出 5301上解上级支出 5302补助下级支出 5401其他支出`;

it('w_xt_kgzb_a2：居民医保完整34项一级表与规定明细；其他险种专用和备案条件不自动启用', () => {
  expect(template.accounts.filter((a) => a.code.length === 4).map((a) => a.code + a.name)).toEqual(
    primary.split(' '),
  );
  expect(template.accounts).toHaveLength(59);
  expect(templateProblems(template)).toEqual([]);
  for (const code of [
    '1202',
    '3101',
    '3201',
    '4102',
    '4202',
    '4601',
    '4602',
    '5102',
    '5103',
    '5104',
    '5105',
    '110106',
    '200105',
    '200106',
  ])
    expect(template.accounts.find((a) => a.code === code)?.disabled, code).toBe(true);
  for (const [code, name] of [
    ['110101', '异地就医预付金'],
    ['110102', '医保预付金'],
    ['110103', '集采预付金'],
    ['110104', '直接结算资金'],
    ['200101', '异地就医预付金'],
    ['200102', '异地就医清算资金'],
    ['200103', '异地就医资金'],
    ['200105', '待确认收入'],
    ['500101', '住院费用支出'],
    ['500102', '门诊费用支出'],
    ['500103', '其他费用支出'],
    ['510101', '商业保险机构承办'],
    ['510102', '自行经办待遇支出'],
    ['51010101', '划转保费支出'],
    ['51010102', '风险赔付'],
    ['51010103', '盈余返还'],
    ['51010104', '其他支出'],
  ])
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      name,
      needsReview: false,
      source: expect.stringContaining('明细名称按原文'),
    });
  expect(template.accounts.find((a) => a.code === '51010103')).toMatchObject({
    category: 'expense',
    direction: 'debit',
    balanceNature: 'no-closing-balance',
    closingRule: 'clearing',
  });
  for (const a of template.accounts) expect(a.source).toContain('https://kjs.mof.gov.cn/');
  expect(template.reports).toEqual([]);
});

it.each(['4-2-2', '4-3-3'])(
  'w_xt_kgzb_a3 / 3：居民医保%s建账、期初、预付核销、大病支出及盈余返还，逐项手算并重开',
  async (scheme) => {
    const app = await createTestApp({ modules: [...integrationModules], seed: false });
    try {
      const api = app.call(server, null);
      await expect(
        api.createBook({
          name: '错误历史年月',
          orgName: '合成经办机构',
          templateId: template.id,
          product: 'qingsong',
          startYear: 2025,
          startMonth: 12,
        }),
      ).rejects.toThrow('不能用于');
      const book = await api.createBook({
        name: '居民医保',
        orgName: '合成医保经办机构',
        templateId: template.id,
        product: 'qingsong',
        startYear: 2026,
        startMonth: 1,
        codeScheme: scheme,
        adminPassword: 'admin',
      });
      const { token } = await app
        .core(null)
        .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
      const opened = app.runtime.bookStore.open(book.id);
      const svc = createCoreServices({
        db: opened.db,
        user: (await loadServiceUser(opened.db, 1))!,
        moduleId: null,
        modules: app.runtime.modules.lookup,
        now: app.runtime.now,
      });
      const rows = await svc.accounts.list();
      const mapped = mapTemplateScheme(template, parseCodeScheme(scheme));
      const code = (native: string) =>
        mapped.accounts.find(
          (a) =>
            a.name === template.accounts.find((n) => n.code === native)!.name &&
            a.source === template.accounts.find((n) => n.code === native)!.source,
        )!.code;
      expect(rows).toHaveLength(59);
      await svc.opening.upsert({
        year: 2026,
        accountId: rows.find((a) => a.code === '1004')!.id,
        balance: 100000,
      });
      await svc.opening.upsert({
        year: 2026,
        accountId: rows.find((a) => a.code === '3001')!.id,
        balance: -100000,
      });
      const partner = await svc.dimensions.create({
        type: 'partner',
        code: 'MED01',
        name: '合成医疗/承保机构',
      });
      async function post(
        lines: { account: string; debit?: number; credit?: number }[],
        withPartner = true,
      ) {
        const raw = await voucherInputFromSpec(svc, { date: '2026-01-05', lines });
        const input = {
          ...raw,
          lines: raw.lines.map((line) =>
            rows.find((a) => a.id === line.accountId)?.dimensions.some((d) => d.required) &&
            withPartner
              ? { ...line, dimensions: { partner: partner.id } }
              : line,
          ),
        };
        const saved = await svc.vouchers.create(input);
        await svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
        await svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
      }
      await expect(
        post(
          [
            { account: code('110102'), debit: 20000 },
            { account: '1004', credit: 20000 },
          ],
          false,
        ),
      ).rejects.toThrow();
      await post([
        { account: code('110102'), debit: 20000 },
        { account: '1004', credit: 20000 },
      ]);
      await post([
        { account: code('500101'), debit: 15000 },
        { account: code('110102'), credit: 15000 },
      ]);
      await post([
        { account: code('51010101'), debit: 10000 },
        { account: '1004', credit: 10000 },
      ]);
      await post([
        { account: '1004', debit: 2000 },
        { account: code('51010103'), credit: 2000 },
      ]);
      const balances = await svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
      expect(balances.find((r) => r.accountCode === '1004')?.closing).toBe(72000);
      expect(balances.find((r) => r.accountCode === code('110102'))?.closing).toBe(5000);
      expect(balances.find((r) => r.accountCode === code('500101'))?.closing).toBe(15000);
      expect(balances.find((r) => r.accountCode === code('51010103'))?.closing).toBe(-2000);
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
      expect((await svc.accounts.list()).find((a) => a.code === code('200105'))?.disabled).toBe(
        true,
      );
      await app.runtime.bookStore.close(book.id);
      expect(await app.core(token).accounts.list()).toEqual(rows);
    } finally {
      await app.close();
    }
  },
);
