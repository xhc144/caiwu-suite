import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { parseFormula } from '../../server/formula';
import { ReportTemplateSchema, type Report, type ReportSnapshot } from '../../shared';
import {
  balanceSheetTemplate,
  cashflowTemplate,
  incomeTemplate,
} from '../../templates/small-business/templates';
import {
  balanceAddress,
  balanceLines,
  cashflowLines,
  incomeLines,
  statementAddress,
} from '../../templates/small-business/catalogue';
import {
  cashflowGolden,
  opening,
  prepareCashflow,
  seedCashflowBook,
  smallBusinessApp,
} from './fixture';

let app: TestApp;
beforeEach(async () => {
  app = await smallBusinessApp();
});
afterEach(async () => {
  await app.close();
});
const api = () => app.call(reportServer);
async function generated(r: Report, period = 202602, confirmUnposted = false) {
  const result = await api().generate({
    id: r.id,
    expectedRevision: r.revision,
    period,
    requestId: randomUUID(),
    confirmUnposted,
  });
  if (result.kind !== 'generated') throw new Error('意外的未过账凭证确认');
  return result.snapshot;
}
const cell = (s: ReportSnapshot, address: string) => {
  const found = s.cells.find((c) => c.address === address);
  if (!found) throw new Error(`缺少${address}`);
  return found;
};
const statementValues = (s: ReportSnapshot, column: 'ytd' | 'comparison') =>
  Array.from({ length: 22 }, (_, i) => cell(s, statementAddress(i + 1, column)).value);

describe('小企业三表 / w_bb_get、w_bb_proc、w_bb_saveas', () => {
  it('严格ReportTemplateSchema三表行次完整；月报和年报第二列不同；未实现格不伪造零', async () => {
    expect(balanceLines).toHaveLength(53);
    expect(incomeLines).toHaveLength(32);
    expect(cashflowLines).toHaveLength(22);
    for (const t of [
      balanceSheetTemplate(),
      incomeTemplate(),
      incomeTemplate('annual'),
      cashflowTemplate(),
      cashflowTemplate('annual'),
    ]) {
      expect(ReportTemplateSchema.parse(t)).toEqual(t);
      expect(t.name).toMatch(/未完成|未实现/);
      expect(t.cells.filter((c) => c.kind === 'money')).toHaveLength(0);
      for (const c of t.cells)
        if (c.kind === 'formula') expect(() => parseFormula(c.source)).not.toThrow();
    }
    for (const make of [incomeTemplate, cashflowTemplate]) {
      const monthly = make();
      const annual = make('annual');
      expect(monthly.cells.find((c) => c.address === 'D5')!.source).toBe('本月金额');
      expect(annual.cells.find((c) => c.address === 'D5')!.source).toBe('上年金额');
      expect(annual.cells.find((c) => c.address === 'D6')).toMatchObject({
        kind: 'text',
        source: expect.stringContaining('未实现'),
      });
    }
    const templates = [balanceSheetTemplate(), incomeTemplate(), cashflowTemplate()];
    for (const t of templates) {
      const imported = await api().importTemplate(t);
      expect(await api().exportTemplate({ id: imported.id })).toEqual(t);
      await expect(
        api().save({ id: imported.id, expectedRevision: 1, template: { ...t, name: '覆盖' } }),
      ).rejects.toThrow(/只读/);
    }
    expect((await api().list({})).map((r) => r.template.code)).toEqual(['301', '302', '303']);
    const count = (await api().list({})).length;
    const invalid = {
      ...cashflowTemplate(),
      code: '304',
      cells: [
        {
          address: 'A1',
          kind: 'formula' as const,
          unit: 'cents' as const,
          currency: 'CNY',
          source: 'UNKNOWN(1)',
        },
      ],
    };
    await expect(api().importTemplate(invalid)).rejects.toThrow(/未知函数/);
    expect(await api().list({})).toHaveLength(count);
  });

  it('现金流量月报22行与独立手算逐格一致：退款、处置净支出、资本化利息、工程工资、银行转存', async () => {
    await seedCashflowBook(app.svc);
    const r = await api().importTemplate(cashflowTemplate());
    const january = await generated(r, 202601);
    const february = await generated(r);
    expect(statementValues(january, 'ytd')).toEqual(cashflowGolden.january.map(String));
    expect(statementValues(january, 'comparison')).toEqual(cashflowGolden.january.map(String));
    expect(statementValues(february, 'ytd')).toEqual(cashflowGolden.ytdFebruary.map(String));
    expect(statementValues(february, 'comparison')).toEqual(cashflowGolden.february.map(String));
    expect(february.checks).toHaveLength(8);
    expect(february.checks.every((c) => c.status === 'pass' && c.difference === '0')).toBe(true);
    expect(
      february.cells
        .filter((c) => c.unit === 'cents')
        .every((c) => /^-?\d+$/.test(c.value) && Number.isSafeInteger(Number(c.value))),
    ).toBe(true);
    const trial = await app.svc.ledger.trialBalance(202601, 202602);
    expect(trial).toMatchObject({ closingDebit: trial.closingCredit });
    expect(await api().snapshot({ id: r.id, period: 202602 })).toEqual(february);
    const exported = await api().exportResult({ id: r.id, period: 202602 });
    expect(exported!.snapshot).toEqual(february);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(exported!.base64, 'base64')).buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('C6').value).toBe(1400.01);
    expect(ws.getCell('D15').value).toBe(-3.01);
    expect(ws.getCell('C27').value).toBe(2919.87);
    expect(ws.getCell('C27').note).toContain('C25+C26');
    expect(ws.getCell('A2').value).toContain('尚未完成');
    expect(wb.worksheets[1]!.getCell('B3').value).toBe('仅已过账');
  });

  it('资产负债表实际取数保持备抵、反向税额、清理贷余；二月年初不冒充月初', async () => {
    for (const [code, amount] of [
      ['1001', 100001],
      ['100201', 2002],
      ['1012', 3003],
      ['1601', 90001],
      ['1602', -20002],
      ['1621', 40001],
      ['1622', -10002],
      ['1701', 30001],
      ['1702', -5002],
      ['1606', -1703],
      ['2221', 404],
    ] as const)
      await opening(app.svc, code, amount);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 11001 },
          { account: '5001', credit: 11001 },
        ],
      },
      {
        date: '2026-02-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 22002 },
          { account: '5001', credit: 22002 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5602', debit: 3003 },
          { account: '1602', credit: 3003 },
        ],
      },
      {
        date: '2026-02-05',
        status: 'posted',
        lines: [
          { account: '5602', debit: 2002 },
          { account: '1602', credit: 2002 },
        ],
      },
    ]);
    const r = await api().importTemplate(balanceSheetTemplate());
    const s = await generated(r);
    for (const [line, closing, yearOpening] of [
      [1, 138009, 105006],
      [18, 90001, 90001],
      [19, 25007, 20002],
      [20, 64994, 69999],
      [23, -1703, -1703],
      [24, 29999, 29999],
      [25, 24999, 24999],
      [36, -404, -404],
    ] as const) {
      expect(cell(s, balanceAddress(line, 'closing'))).toMatchObject({
        value: String(closing),
        unit: 'cents',
      });
      expect(cell(s, balanceAddress(line, 'yearOpening'))).toMatchObject({
        value: String(yearOpening),
        unit: 'cents',
      });
    }
    for (const line of [
      4, 5, 9, 11, 14, 15, 16, 27, 28, 29, 30, 33, 34, 40, 41, 42, 43, 44, 45, 46, 47, 48, 51, 52,
      53,
    ])
      expect(cell(s, balanceAddress(line, 'closing'))).toMatchObject({
        unit: 'text',
        value: expect.stringContaining('未实现'),
      });
    expect(s.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('利润表手算黄金口径：退货冲减后净利润3297分，损益结转后不能以净余额或单边累计替代', async () => {
    const golden = [
      10001, 4001, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1501, 0, 0, 0, 0, 0, -201, 4298, 0, 0, 0, 0, 0,
      0, 0, 0, 4298, 1001, 3297,
    ];
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 11002 },
          { account: '5001', credit: 11002 },
        ],
      },
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '5001', debit: 1001 },
          { account: '1001', credit: 1001 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5401', debit: 5002 },
          { account: '1001', credit: 5002 },
        ],
      },
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1001 },
          { account: '5401', credit: 1001 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5602', debit: 1501 },
          { account: '1001', credit: 1501 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5111', debit: 201 },
          { account: '1001', credit: 201 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '5801', debit: 1001 },
          { account: '1001', credit: 1001 },
        ],
      },
    ]);
    const before = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
    expect(-before.find((r) => r.accountCode === '5001')!.closing).toBe(golden[0]);
    expect(before.find((r) => r.accountCode === '5401')!.closing).toBe(golden[1]);
    expect(before.find((r) => r.accountCode === '1001')!.closing).toBe(golden[31]);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-31',
        status: 'posted',
        summary: '测试损益结转',
        lines: [
          { account: '5001', debit: 10001 },
          { account: '3103', credit: 10001 },
        ],
      },
      {
        date: '2026-01-31',
        status: 'posted',
        summary: '测试损益结转',
        lines: [
          { account: '3103', debit: 6704 },
          { account: '5401', credit: 4001 },
          { account: '5602', credit: 1501 },
          { account: '5111', credit: 201 },
          { account: '5801', credit: 1001 },
        ],
      },
    ]);
    const after = await app.svc.ledger.balances({
      periodFrom: 202601,
      periodTo: 202601,
      includeZero: true,
    });
    expect(after.find((r) => r.accountCode === '5001')).toMatchObject({
      closing: 0,
      ytdCredit: 11002,
    });
    expect(after.find((r) => r.accountCode === '5401')).toMatchObject({
      closing: 0,
      ytdDebit: 5002,
    });
    expect(after.find((r) => r.accountCode === '3103')!.closing).toBe(-3297);
    const s = await generated(await api().importTemplate(incomeTemplate()), 202601);
    for (let line = 1; line <= golden.length; line++)
      for (const column of ['ytd', 'comparison'] as const)
        expect(cell(s, statementAddress(line, column))).toMatchObject({
          unit: 'text',
          value: expect.stringContaining('未实现'),
        });
  });

  it('现金流量年报只生成已支持的本年列；上年金额保持明确缺项，不复用本月数', async () => {
    await seedCashflowBook(app.svc);
    const r = await api().importTemplate(cashflowTemplate('annual'));
    const s = await generated(r, 202612);
    expect(statementValues(s, 'ytd')).toEqual(cashflowGolden.ytdFebruary.map(String));
    for (let line = 1; line <= 22; line++)
      expect(cell(s, statementAddress(line, 'comparison'))).toMatchObject({
        unit: 'text',
        value: '未实现：需上年全年取数',
      });
  });

  it('年中启用：按启用前累计还原年初，现金流量累计期初和本月期初分别取数', async () => {
    await app.close();
    app = await smallBusinessApp(3);
    await prepareCashflow(app.svc);
    await opening(app.svc, '1001', 150001, { ytdDebit: 60001, ytdCredit: 10001 });
    await opening(app.svc, '3001', -150001, { ytdDebit: 10001, ytdCredit: 60001 });
    await seedVouchers(app.svc, [
      {
        date: '2026-06-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 2001, dims: { cashflow: 'SB01' } },
          { account: '5001', credit: 2001 },
        ],
      },
    ]);
    const balance = await generated(await api().importTemplate(balanceSheetTemplate()), 202606);
    expect(cell(balance, balanceAddress(1, 'yearOpening')).value).toBe('100001');
    expect(cell(balance, balanceAddress(1, 'closing')).value).toBe('152002');
    const flow = await generated(await api().importTemplate(cashflowTemplate()), 202606);
    expect(cell(flow, 'C26').value).toBe('100001');
    expect(cell(flow, 'D26').value).toBe('150001');
    // core没有现金流量期初分配，历史50000分不可悄悄补零；核对须揭示缺口。
    expect(flow.checks.find((c) => c.name === '本年累计金额期末现金与总账一致')).toMatchObject({
      status: 'fail',
      difference: '-50000',
    });
  });

  it('跨年取数与年结储存期初前后相同：年初150002分，不能回到启用年度期初', async () => {
    await app.close();
    app = await smallBusinessApp(1, 2025);
    const cash = await app.svc.accounts.require('1001');
    const capital = await app.svc.accounts.require('3001');
    await app.svc.opening.upsert({ year: 2025, accountId: cash.id, balance: 100001 });
    await app.svc.opening.upsert({ year: 2025, accountId: capital.id, balance: -100001 });
    await app.svc.periods.ensureYear(2026);
    await seedVouchers(app.svc, [
      {
        date: '2025-12-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 50001 },
          { account: '5001', credit: 50001 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 2002 },
          { account: '5001', credit: 2002 },
        ],
      },
      {
        date: '2026-02-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 3003 },
          { account: '5001', credit: 3003 },
        ],
      },
    ]);
    const r = await api().importTemplate(balanceSheetTemplate());
    const before = await generated(r);
    expect(cell(before, balanceAddress(1, 'yearOpening')).value).toBe('150002');
    expect(cell(before, balanceAddress(1, 'closing')).value).toBe('155007');
    await app.svc.tx((svc) =>
      svc.opening.replaceYear(2026, [
        { accountId: cash.id, balance: 150002 },
        { accountId: capital.id, balance: -150002 },
      ]),
    );
    const after = await generated(r);
    expect(cell(after, balanceAddress(1, 'yearOpening')).value).toBe('150002');
    expect(cell(after, balanceAddress(1, 'closing')).value).toBe('155007');
  });

  it('分类漏分、现金内部转存单边误分分别出现审核差额；当前引擎仍能导出的缺口保留', async () => {
    await seedCashflowBook(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '1001', debit: 777 },
          { account: '5001', credit: 777 },
        ],
      },
      {
        date: '2026-02-10',
        status: 'posted',
        lines: [
          { account: '100201', debit: 333, dims: { cashflow: 'SB_INTERNAL' } },
          { account: '1001', credit: 333, dims: { cashflow: 'SB06' } },
        ],
      },
    ]);
    const r = await api().importTemplate(cashflowTemplate());
    const s = await generated(r);
    expect(s.checks.find((c) => c.name === '本月借方分类完整')).toMatchObject({
      status: 'fail',
      difference: '777',
    });
    expect(s.checks.find((c) => c.name === '本月现金内部转存净额为零')).toMatchObject({
      status: 'fail',
      difference: '333',
    });
    const exported = await api().exportResult({ id: r.id, period: 202602 });
    expect(exported!.snapshot.checks.some((c) => c.status === 'fail')).toBe(true);
    expect(exported!.snapshot.template.name).toContain('未完成');
  });

  it('未过账警告取消不存快照；按已过账继续保持黄金值；缺科目不能返回假零', async () => {
    await seedCashflowBook(app.svc);
    await seedVouchers(app.svc, [
      {
        date: '2026-02-11',
        status: 'pending',
        lines: [
          { account: '1001', debit: 999, dims: { cashflow: 'SB01' } },
          { account: '5001', credit: 999 },
        ],
      },
    ]);
    const r = await api().importTemplate(cashflowTemplate());
    expect(
      await api().generate({
        id: r.id,
        expectedRevision: 1,
        period: 202602,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ kind: 'confirmation', count: 1 });
    expect(await api().snapshot({ id: r.id, period: 202602 })).toBeNull();
    expect(statementValues(await generated(r, 202602, true), 'ytd')).toEqual(
      cashflowGolden.ytdFebruary.map(String),
    );
    await app.svc.db.deleteFrom('account').where('code', '=', '1012').execute();
    await expect(generated(r, 202603, true)).rejects.toThrow(/1012/);
    expect(await api().snapshot({ id: r.id, period: 202603 })).toBeNull();
  });

  it('真实路由权限阻止导入/生成/导出；生成失败事务保留本切片上次成功快照', async () => {
    await seedCashflowBook(app.svc);
    const readonly = app.call(
      reportServer,
      await app.addUser('reader', { permissions: ['report-engine.view'] }),
    );
    await expect(readonly.importTemplate(cashflowTemplate())).rejects.toThrow(/权限/);
    expect(await api().list({})).toHaveLength(0);
    const r = await api().importTemplate(cashflowTemplate());
    await expect(
      readonly.generate({ id: r.id, expectedRevision: 1, period: 202602, requestId: randomUUID() }),
    ).rejects.toThrow(/权限/);
    await expect(readonly.exportResult({ id: r.id, period: 202602 })).rejects.toThrow(/权限/);
    expect(await api().snapshot({ id: r.id, period: 202602 })).toBeNull();
    const copy = await api().copy({ sourceId: r.id, code: '313', name: '事务测试副本' });
    const previous = await generated(copy);
    const broken = await api().save({
      id: copy.id,
      expectedRevision: 1,
      template: {
        ...copy.template,
        cells: copy.template.cells.map((c) => (c.address === 'C6' ? { ...c, source: 'C6/0' } : c)),
      },
    });
    await expect(generated(broken)).rejects.toThrow(/循环依赖/);
    expect(await api().snapshot({ id: copy.id, period: 202602 })).toEqual(previous);
  });
});
