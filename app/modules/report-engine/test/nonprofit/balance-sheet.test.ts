import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import {
  balance401ClosingTemplate,
  preparedBalance401AnnualTemplate,
  checkBalance401Sources,
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
import { fixtureMapping, seedCashflowBook } from './fixture';
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

  it('共享第8参数只按已确认JSON契约序列化；年初、excludePnl实际执行仍待共享SHA', () => {
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
        { from: 'previousYearEnd' } as never,
      ),
    ).toThrow(/统一契约/);
    const annual = preparedBalance401AnnualTemplate(
      balanceFixtureMapping(),
      balanceFixtureMapping(202601),
    );
    expect(annual.cells.find((c) => c.address === 'B37')?.kind).toBe('formula');
    expect(annual.name).toContain('待验证');
    expect(() =>
      preparedBalance401AnnualTemplate(balanceFixtureMapping(), balanceFixtureMapping(202602)),
    ).toThrow(/年初分类/);
  });
});
