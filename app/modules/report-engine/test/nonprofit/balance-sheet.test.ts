import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  balance401ClosingTemplate,
  balance401AnnualTemplate,
  checkBalance401Sources,
  validateBalance401AnnualGeneration,
} from '../../templates/nonprofit/balance-sheet';
import {
  activityMovement,
  statementBalance,
  yearOpening,
} from '../../templates/nonprofit/period-formulas';
import {
  cashflow403GenerateGuard,
  validateCashflow403Generation,
} from '../../templates/nonprofit/cashflow';
import { fixtureMapping, seedCashflowBook, seedCashflowDimensions } from './fixture';
import {
  balance401ClosingGolden,
  balanceFixtureChart,
  balanceFixtureMapping,
  balanceTestServer,
  seedBalance401Book,
} from './balance-fixture';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({
    modules: [balanceTestServer],
    product: 'minfei',
    templateId: balanceFixtureChart.id,
    seed: false,
  });
});
afterEach(async () => {
  await app?.close();
});

describe('401期末真实取数切片与共享契约接线准备', () => {
  it('共享接线后真实生成年初与期末：1月发生不污染年初，两时点到期重分类分别采用来源', async () => {
    await seedBalance401Book(app.svc);
    await seedCashflowDimensions(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '100201', debit: 1000, dims: { cashflow: 'NF_otherOperatingReceipts' } },
          { account: '3101', credit: 1000 },
        ],
      },
    ]);
    const closing = balanceFixtureMapping();
    closing.groups.currentInvestment.accounts.push('150102');
    closing.groups.currentInvestmentImpairment.accounts.push('150202');
    closing.groups.debtInvestment.accounts = ['150103'];
    closing.groups.debtInvestmentImpairment.accounts = ['150203'];
    closing.groups.currentDebt.accounts.push('230102');
    closing.groups.longBorrowing.accounts = ['230103'];
    const opening = balanceFixtureMapping(202601);
    await checkBalance401Sources(app.svc, 202602, closing);
    const api = app.call(balanceTestServer);
    const report = await api.importTemplate(balance401AnnualTemplate(closing, opening));
    const out = await api.generate({
      id: report.id,
      expectedRevision: 1,
      period: 202602,
      requestId: randomUUID(),
    });
    if (out.kind !== 'generated') throw new Error('未生成');
    const values = Object.fromEntries(
      out.snapshot.cells.filter((c) => c.unit === 'cents').map((c) => [c.address, c.value]),
    );
    const beginning = Object.fromEntries(
      Object.entries(balance401ClosingGolden).map(([a, v]) => [
        a.replace(/^C/, 'B').replace(/^F/, 'E'),
        v,
      ]),
    );
    expect(values).toEqual({
      ...balance401ClosingGolden,
      ...beginning,
      C6: '61000',
      C12: '37000',
      C14: '157000',
      C18: '0',
      C20: '0',
      C34: '83000',
      C37: '250000',
      F12: '30000',
      F14: '55000',
      F16: '0',
      F20: '0',
      F25: '145000',
      F27: '185000',
      F28: '250000',
    });
    expect(out.snapshot.checks.map((c) => c.status)).toEqual(['pass', 'pass']);
    const result = await api.exportResult({ id: report.id, period: 202602 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(result!.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getCell('B37').value).toBe(2490);
    expect(wb.worksheets[0]!.getCell('C37').value).toBe(2500);
  });
  it('w_bb_get/proc/saveas：全部期末项目与249000分黄金相等，受托现金不重计、减值净额和到期分类正确', async () => {
    await seedBalance401Book(app.svc);
    const mapping = balanceFixtureMapping();
    await checkBalance401Sources(app.svc, 202602, mapping);
    const api = app.call(balanceTestServer);
    const report = await api.importTemplate(balance401ClosingTemplate(mapping));
    const out = await api.generate({
      id: report.id,
      expectedRevision: 1,
      period: 202602,
      requestId: randomUUID(),
    });
    if (out.kind !== 'generated') throw new Error('未生成');
    expect(
      Object.fromEntries(
        out.snapshot.cells.filter((c) => c.unit === 'cents').map((c) => [c.address, c.value]),
      ),
    ).toEqual(balance401ClosingGolden);
    expect(out.snapshot.cells.find((c) => c.address === 'B37')?.value).toBe('待接入真实取数');
    expect(out.snapshot.checks[0]).toMatchObject({ status: 'pass', difference: '0' });
    const exported = await api.exportResult({ id: report.id, period: 202602 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getCell('C37').value).toBe(2490);
    expect(wb.worksheets[0]!.getCell('F28').value).toBe(2490);
    expect(wb.worksheets[0]!.getCell('B37').value).toBe('待接入真实取数');
  });

  it('年中启用缺少年初期间时，真实生成拒绝，不将未知年初补零', async () => {
    await app.close();
    app = await createTestApp({
      modules: [balanceTestServer],
      product: 'minfei',
      templateId: balanceFixtureChart.id,
      startMonth: 7,
      seed: false,
    });
    await seedBalance401Book(app.svc);
    const api = app.call(balanceTestServer);
    const r = await api.importTemplate(
      balance401AnnualTemplate(balanceFixtureMapping(202607), balanceFixtureMapping(202601)),
    );
    await expect(
      api.generate({ id: r.id, expectedRevision: 1, period: 202607, requestId: randomUUID() }),
    ).rejects.toThrow('2026年01月早于账套启用期间2026年07月');
    expect(await api.snapshot({ id: r.id, period: 202607 })).toBeNull();
  });

  it('401年度事务预检明确拒绝含未过账、错误年初时点及范围缺月，公共注册仍待owner', async () => {
    await seedBalance401Book(app.svc);
    const sources = { closing: balanceFixtureMapping(), opening: balanceFixtureMapping(202601) };
    await app.svc.tx((s) =>
      validateBalance401AnnualGeneration(s, { period: 202602, includeUnposted: false }, sources),
    );
    await expect(
      app.svc.tx((s) =>
        validateBalance401AnnualGeneration(s, { period: 202602, includeUnposted: true }, sources),
      ),
    ).rejects.toThrow('民非资产负债表取数只允许已过账');
    await expect(
      app.svc.tx((s) =>
        validateBalance401AnnualGeneration(
          s,
          { period: 202602, includeUnposted: false },
          { ...sources, opening: balanceFixtureMapping(202602) },
        ),
      ),
    ).rejects.toThrow('年初来源不是本次生成年度1月');
    await app.svc.db.deleteFrom('period').where('period', '=', 202602).execute();
    await expect(
      app.svc.tx((s) =>
        validateBalance401AnnualGeneration(
          s,
          { period: 202603, includeUnposted: false },
          { ...sources, closing: balanceFixtureMapping(202603) },
        ),
      ),
    ).rejects.toThrow(/未建立期间/);
  });

  it('年度取数范围内部缺少期间时，真实生成拒绝并保持无快照', async () => {
    await seedBalance401Book(app.svc);
    await app.svc.db.deleteFrom('period').where('period', '=', 202602).execute();
    const api = app.call(balanceTestServer);
    const r = await api.importTemplate(
      balance401AnnualTemplate(balanceFixtureMapping(202603), balanceFixtureMapping(202601)),
    );
    await expect(
      api.generate({ id: r.id, expectedRevision: 1, period: 202603, requestId: randomUUID() }),
    ).rejects.toThrow('资产负债表年度范围内存在未建立期间');
    expect(await api.snapshot({ id: r.id, period: 202603 })).toBeNull();
  });

  it('来源门禁拒绝期间错位、父科目重复、未分类余额、未结转损益及缺少分类依据', async () => {
    await seedBalance401Book(app.svc);
    const mapping = balanceFixtureMapping();
    await expect(checkBalance401Sources(app.svc, 202603, mapping)).rejects.toThrow(/期间不一致/);
    expect(() =>
      balance401ClosingTemplate({
        ...mapping,
        groups: { ...mapping.groups, fixedCost: { ...mapping.groups.fixedCost, basis: '' } },
      }),
    ).toThrow(/依据/);
    expect(() =>
      balance401ClosingTemplate({
        ...mapping,
        groups: { ...mapping.groups, fixedCost: mapping.groups.cash },
      }),
    ).toThrow(/重复分类/);
    const parent = structuredClone(mapping);
    parent.groups.cash.accounts = ['1001', '1002'];
    parent.groups.agencyCash.accounts = ['1002'];
    await expect(checkBalance401Sources(app.svc, 202602, parent)).rejects.toThrow(/末级/);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '5901', debit: 100 },
          { account: '1122', credit: 100 },
        ],
      },
    ]);
    await expect(checkBalance401Sources(app.svc, 202602, mapping)).rejects.toThrow(/未分类/);
  });

  it('尚有真实收入费用余额时拒绝401净资产假定，不将本期未结转数补零', async () => {
    await seedBalance401Book(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1122', debit: 100 },
          { account: '410101', credit: 100 },
        ],
      },
    ]);
    await expect(checkBalance401Sources(app.svc, 202602, balanceFixtureMapping())).rejects.toThrow(
      /未结转收入费用/,
    );
  });

  it('403可供共享事务调用的门禁拒绝2027和含未过账，且在新账务造成漏分类后重新拒绝', async () => {
    await seedCashflowBook(app.svc);
    const guard = cashflow403GenerateGuard(fixtureMapping());
    await app.svc.tx((s) =>
      validateCashflow403Generation(s, { period: 202602, includeUnposted: false }, guard),
    );
    await expect(
      app.svc.tx((s) =>
        validateCashflow403Generation(s, { period: 202702, includeUnposted: false }, guard),
      ),
    ).rejects.toThrow(/2026/);
    await expect(
      app.svc.tx((s) =>
        validateCashflow403Generation(s, { period: 202602, includeUnposted: true }, guard),
      ),
    ).rejects.toThrow(/已过账/);
    await app.svc.dimensions.create({ type: 'cashflow', code: 'NEW_UNMAPPED', name: '新增未分类' });
    await seedVouchers(app.svc, [
      {
        date: '2026-02-09',
        status: 'posted',
        lines: [
          { account: '100201', debit: 100, dims: { cashflow: 'NEW_UNMAPPED' } },
          { account: '410101', credit: 100 },
        ],
      },
    ]);
    await expect(
      app.svc.tx((s) =>
        validateCashflow403Generation(s, { period: 202602, includeUnposted: false }, guard),
      ),
    ).rejects.toThrow(/未分类|未映射/);
  });

  it('共享第8参数使用实际schema/helper，拒绝无效期间，不维护候选函数', () => {
    const formula = yearOpening('100201');
    expect(formula).toContain('BALANCE("100201","opening","cents","CNY","signed","none","",');
    const optionsLiteral = formula.slice(formula.indexOf(',"{') + 1, -1);
    expect(JSON.parse(JSON.parse(optionsLiteral))).toEqual({
      from: 'yearStart',
      to: 'yearStart',
      closing: 'include',
      side: 'net',
    });
    expect(activityMovement('410101', 'ytd')).toContain('excludePnl');
    expect(activityMovement('410101', 'ytd')).not.toContain('NETACTIVITY');
    expect(() =>
      statementBalance(
        {
          account: '1001',
          metric: 'opening',
          unit: 'cents',
          currency: 'CNY',
          direction: 'signed',
          dimension: 'none',
          item: '',
        },
        { from: 'previousYearTypo' } as never,
      ),
    ).toThrow();
    const annual = balance401AnnualTemplate(balanceFixtureMapping(), balanceFixtureMapping(202601));
    expect(annual.cells.find((c) => c.address === 'B37')?.kind).toBe('formula');
    expect(annual.name).toContain('取数切片');
    expect(() =>
      balance401AnnualTemplate(balanceFixtureMapping(), balanceFixtureMapping(202602)),
    ).toThrow(/年初分类/);
  });
});
