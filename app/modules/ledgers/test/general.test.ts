import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { createTestApp, createTestBook, seedVouchers, type TestApp } from '@caiwu/testkit';
import { assertSafePrintContent } from '@caiwu/print';
import { openDatabase } from '@caiwu/db';
import { createCoreServices, type CoreDB, type CoreServices } from '@caiwu/core/server';
import server from '../server';
import { ledgersService } from '../server/service';
import { generalTableRows } from '../presentation';
import { GENERAL_COLUMNS, DEFAULT_COLUMNS, parseLedgerUrl, type LedgerQuery } from '../shared';
import { seedGeneralBook } from './general-seed';

const query = (patch: Partial<LedgerQuery> = {}): LedgerQuery => ({
  kind: 'general',
  periodFrom: 202607,
  periodTo: 202608,
  account: '1001',
  accountTo: '',
  dimensions: {},
  currency: '',
  includeUnposted: false,
  includeZero: false,
  dimensionType: 'partner',
  multiMode: 'auto',
  valueMode: 'base',
  groupAuxiliary: false,
  ...patch,
});
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], startMonth: 7 });
});
afterEach(async () => {
  await app.close();
});

describe('w_zc_zc/w_zc_zc_1 总分类账', () => {
  it('期中启用前月额及余额留空，账前累计仅计一次；零本月保留非零YTD', async () => {
    await seedGeneralBook(app.svc);
    const report = await app.call(server).report(query({ periodFrom: 202601 }));
    for (const r of report.rows.filter((r) => r.summary.includes('启用前'))) {
      expect(r).toMatchObject({
        debit: null,
        credit: null,
        balance: null,
        signedBalance: null,
        side: '未知',
        href: null,
      });
      expect(r.detailHref).toBeUndefined();
    }
    expect(report.rows.filter((r) => r.summary.includes('启用前'))).toHaveLength(6);
    expect(report.rows.find((r) => r.summary === '启用期初余额')!.signedBalance).toBe(6000);
    const july = report.rows.find((r) => r.id.endsWith('202607-month'))!;
    expect(july).toMatchObject({ debit: 1700, credit: 500, signedBalance: 7200 });
    expect(report.rows.filter((r) => r.kind === 'ytd').map((r) => [r.debit, r.credit])).toEqual([
      [11700, 4500],
      [11700, 4500],
    ]);
    expect(report.rows.filter((r) => r.kind === 'month').at(-1)).toMatchObject({
      debit: 0,
      credit: 0,
      signedBalance: 7200,
    });
    const detail = await app.call(server).report(query({ kind: 'detail', periodTo: 202607 }));
    expect(detail.rows.at(-1)!.signedBalance).toBe(july.signedBalance);
    expect(detail.rows.find((r) => r.kind === 'ytd')).toMatchObject({ debit: 11700, credit: 4500 });
  });
  it('只查启用前仍明确未知，年度默认起于1月，不调用core伪造零', async () => {
    const report = await app.call(server).report(query({ periodFrom: 202601, periodTo: 202602 }));
    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((r) => r.balance === null && r.debit === null && !r.detailHref)).toBe(
      true,
    );
    expect(parseLedgerUrl({}, 202607, 'general').query).toMatchObject({
      periodFrom: 202601,
      periodTo: 202607,
    });
  });
  it('跨年承接期末，年度累计重置，逐月勾稽core及既有明细', async () => {
    await seedGeneralBook(app.svc);
    const report = await app.call(server).report(query({ periodFrom: 202612, periodTo: 202701 }));
    expect(report.rows[0]!.signedBalance).toBe(7200);
    expect(report.rows.filter((r) => r.kind === 'closing').map((r) => r.signedBalance)).toEqual([
      7500, 7601,
    ]);
    expect(report.rows.filter((r) => r.kind === 'ytd').map((r) => [r.debit, r.credit])).toEqual([
      [12000, 4500],
      [101, 0],
    ]);
    for (const p of [202612, 202701]) {
      const b = (
        await app.svc.ledger.balances({ periodFrom: p, periodTo: p, accountCodes: ['1001'] })
      )[0]!;
      const month = report.rows.find((r) => r.id.endsWith(`${p}-month`))!;
      expect(month).toMatchObject({ debit: b.debit, credit: b.credit, signedBalance: b.closing });
      const detail = await app
        .call(server)
        .report(query({ kind: 'detail', periodFrom: p, periodTo: p }));
      expect(detail.rows.at(-1)!.signedBalance).toBe(b.closing);
    }
  });
  it('年结已存期初时不重复承接上年发生，下一年累计只计当年', async () => {
    await seedGeneralBook(app.svc);
    await app.svc.periods.ensureYear(2027, { openingStored: true });
    await app.svc.opening.upsert({
      year: 2027,
      accountId: (await app.svc.accounts.require('1001')).id,
      balance: 7500,
    });
    const report = await app.call(server).report(query({ periodFrom: 202701, periodTo: 202701 }));
    expect(report.rows[0]!.signedBalance).toBe(7500);
    expect(report.rows.find((r) => r.kind === 'ytd')).toMatchObject({ debit: 101, credit: 0 });
    expect(report.rows.at(-1)!.signedBalance).toBe(7601);
  });
  it('两条真实SQLite连接：月份之间过账不混入当前快照，下次查询可见', async () => {
    await seedGeneralBook(app.svc);
    const connection = openDatabase<CoreDB>(app.runtime.bookStore.open(app.book.id).file);
    const base = app.svcFor('ledgers');
    const writer = createCoreServices({ ...base.ctx, db: connection.db, moduleId: null });
    let release!: () => void;
    const signal = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 在读事务外建立写入异步链，避免越过 core 的事务连接保护。
    const written = (async () => {
      await signal;
      await seedVouchers(writer, [
        {
          date: '2026-08-01',
          status: 'posted',
          lines: [
            { account: '1001', debit: 100 },
            { account: '4001', credit: 100 },
          ],
        },
      ]);
    })();
    const reader: CoreServices = {
      ...base,
      tx: (fn) =>
        base.tx((tsvc) =>
          fn({
            ...tsvc,
            ledger: {
              ...tsvc.ledger,
              balances: async (q) => {
                const rows = await tsvc.ledger.balances(q);
                if (q.periodFrom === 202607) {
                  release();
                  await written;
                }
                return rows;
              },
            },
          }),
        ),
    };
    try {
      const report = await ledgersService(reader).report(query());
      expect(report.rows.at(-1)!.signedBalance).toBe(7200);
      const next = await app.call(server).report(query());
      expect(next.rows.at(-1)!.signedBalance).toBe(7300);
    } finally {
      release();
      await written;
      await connection.close();
    }
  });
  it('父科目汇总完整下级，范围边缘只覆盖实际子项，父子不重计', async () => {
    await seedGeneralBook(app.svc);
    const api = app.call(server);
    const parent = await api.report(query({ account: '1002', periodTo: 202607 }));
    expect(new Set(parent.rows.map((r) => r.account))).toEqual(new Set(['1002 银行存款']));
    expect(parent.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 1210,
      signedBalance: 1210,
    });
    const edge = await api.report(query({ account: '', accountTo: '100201', periodTo: 202607 }));
    expect(edge.rows.some((r) => r.account.startsWith('1002 '))).toBe(false);
    expect(
      edge.rows.find((r) => r.account.startsWith('100201 ') && r.kind === 'month')!.debit,
    ).toBe(500);
    expect(edge.rows.some((r) => r.account.startsWith('100202 '))).toBe(false);
    const leaves = await api.report(
      query({ account: '100201', accountTo: '100202', periodTo: 202607 }),
    );
    expect(leaves.rows.filter((r) => r.kind === 'month').reduce((s, r) => s + r.debit!, 0)).toBe(
      1210,
    );
  });
  it('未过账只含待审核/已审核，草稿作废排除，方向保持借正贷负及红字', async () => {
    await seedGeneralBook(app.svc);
    const api = app.call(server);
    const included = await api.report(query({ includeUnposted: true, periodTo: 202607 }));
    expect(included.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 2000,
      credit: 500,
      signedBalance: 7500,
    });
    const credit = await api.report(query({ account: '4001', periodTo: 202607 }));
    expect(credit.rows.at(-1)).toMatchObject({ side: '贷', balance: 8410, signedBalance: -8410 });
    await seedVouchers(app.svc, [
      {
        date: '2026-08-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: -8000 },
          { account: '4001', credit: -8000 },
        ],
      },
    ]);
    const red = await api.report(query());
    expect(red.rows.find((r) => r.id.endsWith('202608-month'))).toMatchObject({
      debit: -8000,
      side: '贷',
      signedBalance: -800,
      balance: 800,
    });
  });
  it('本位币NULL行、USD及数字辅助项均直接采用core口径，钻取带齐条件', async () => {
    await seedGeneralBook(app.svc);
    const api = app.call(server);
    expect(
      (await api.report(query({ account: '1002', currency: 'CNY' }))).rows.find(
        (r) => r.kind === 'month',
      )!.debit,
    ).toBe(500);
    const usd = await api.report(
      query({ account: '1002', currency: 'USD', includeUnposted: true }),
    );
    const href = usd.rows.find((r) => r.kind === 'month')!.detailHref!;
    const params = new URL(href, 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      account: '1002',
      from: '202607',
      to: '202607',
      currency: 'USD',
      includeUnposted: '1',
      dims: '{}',
    });
    const partner = (await app.svc.dimensions.getByCode('partner', 'C001'))!;
    await seedVouchers(app.svc, [
      {
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '1122', debit: 345, dims: { partner: 'C001' } },
          { account: '4001', credit: 345 },
        ],
      },
    ]);
    const filtered = await api.report(
      query({ account: '1122', dimensions: { partner: partner.id } }),
    );
    expect(filtered.rows.find((r) => r.kind === 'month')!.debit).toBe(345);
    expect(
      new URL(
        filtered.rows.find((r) => r.kind === 'month')!.detailHref!,
        'http://localhost',
      ).searchParams.get('dims'),
    ).toBe(JSON.stringify({ partner: partner.id }));
  });
  it('本期零余额零发生但历史YTD不为零，仍保留完整月份', async () => {
    const b = await createTestBook();
    try {
      await seedVouchers(b.svc, [
        {
          date: '2026-01-01',
          status: 'posted',
          lines: [
            { account: '100201', debit: 100 },
            { account: '4001', credit: 100 },
          ],
        },
        {
          date: '2026-01-02',
          status: 'posted',
          lines: [
            { account: '100201', credit: 100 },
            { account: '4001', debit: 100 },
          ],
        },
      ]);
      const report = await ledgersService(b.forModule('ledgers')).report(
        query({ account: '1002', periodFrom: 202602, periodTo: 202602 }),
      );
      expect(report.rows.find((r) => r.kind === 'month')).toMatchObject({
        debit: 0,
        credit: 0,
        signedBalance: 0,
      });
      expect(report.rows.find((r) => r.kind === 'ytd')).toMatchObject({ debit: 100, credit: 100 });
    } finally {
      await b.close();
    }
  });
  it.each([9000000000000001, -9000000000000001, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])(
    '大金额 %s 分真实XLSX文本逐分回读，打印及查询同快照',
    async (amount) => {
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require('1001')).id,
        balance: amount,
      });
      const api = app.call(server);
      const file = await api.export({ ...query({ periodTo: 202607 }), columns: GENERAL_COLUMNS });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
      const cell = workbook.worksheets[0]!.getRow(3).getCell(8);
      const abs = BigInt(Math.abs(amount));
      expect(cell.value).toBe(`${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(file.report.rows[0]!.signedBalance).toBe(amount);
      const print = await api.print({ ...query({ periodTo: 202607 }), columns: GENERAL_COLUMNS });
      expect(print.report).toEqual(file.report);
      expect(print.html).toContain(String(cell.value));
      expect(() => assertSafePrintContent(print.html)).not.toThrow();
    },
  );
  it('真实过账累计超出安全整数，查询/导出/打印均拒绝，不改用浮点', async () => {
    await seedVouchers(
      app.svc,
      [1, 2].map(() => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: 4_600_000_000_000_001 },
          { account: '4001', credit: 4_600_000_000_000_001 },
        ],
      })),
    );
    const api = app.call(server);
    await expect(api.report(query())).rejects.toThrow(/安全整数/);
    await expect(api.export({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/安全整数/);
    await expect(api.print({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/安全整数/);
  });
  it('真实105笔凭证全额汇总；109个月展示分页/折叠不影响导出', async () => {
    await seedVouchers(
      app.svc,
      Array.from({ length: 105 }, (_, i) => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '1001', debit: i + 1 },
          { account: '4001', credit: i + 1 },
        ],
      })),
    );
    const api = app.call(server);
    for (let year = 2027; year <= 2035; year++) await app.svc.periods.ensureYear(year);
    const q = query({ periodTo: 203507 });
    const report = await api.report(q);
    expect(report.rows.filter((r) => r.kind === 'month')).toHaveLength(109);
    expect(report.rows[1]!.debit).toBe(5565);
    expect(report.rows.at(-1)!.signedBalance).toBe(5565);
    const tree = generalTableRows(report.rows);
    expect(tree).toHaveLength(110);
    expect(tree[1]!.children).toHaveLength(2);
    expect(report.rows[1]!.children).toBeUndefined();
    const exported = await api.export({ ...q, columns: GENERAL_COLUMNS });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    expect(workbook.worksheets[0]!.rowCount).toBe(report.rows.length + 2);
    expect(exported.report).toEqual(report);
  });
  it('w_zc_zc：不存在/倒置科目及非法条件拒绝；w_zc_zc_1空输出阻止', async () => {
    const api = app.call(server);
    for (const patch of [
      { account: '999999' },
      { account: '4001', accountTo: '1001' },
      { currency: 'NOPE' },
      { dimensions: { partner: 9999 } },
      { periodFrom: 202608, periodTo: 202607 },
      { periodTo: 203607 },
    ])
      await expect(api.report(query(patch))).rejects.toThrow();
    await expect(api.print({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(
      /没有账簿记录/,
    );
    await expect(api.export({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(
      /没有账簿记录/,
    );
  });
  it('w_zc_zc_1：查看/导出/打印/格式权限独立，查询输出保持只读', async () => {
    await seedGeneralBook(app.svc);
    const before = await app.svc.vouchers.list({});
    const viewer = app.call(server, await app.addUser('viewer', { permissions: ['ledgers.view'] }));
    const change = {
      kind: 'general' as const,
      columns: GENERAL_COLUMNS,
      confirmed: true,
      expectedRevision: 0,
    };
    expect((await viewer.report(query())).rows.length).toBeGreaterThan(0);
    await expect(viewer.saveFormat(change)).rejects.toThrow(/权限/);
    await expect(viewer.export({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/权限/);
    await expect(viewer.print({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/权限/);
    for (const permission of ['ledgers.export', 'ledgers.print']) {
      const only = app.call(
        server,
        await app.addUser(permission.replace('.', ''), { permissions: [permission] }),
      );
      if (permission.endsWith('export'))
        await expect(only.export({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/权限/);
      else
        await expect(only.print({ ...query(), columns: GENERAL_COLUMNS })).rejects.toThrow(/权限/);
    }
    const denied = app.call(server, await app.addUser('denied'));
    await expect(denied.report(query())).rejects.toThrow(/权限/);
    const api = app.call(server);
    await api.export({ ...query(), columns: GENERAL_COLUMNS });
    await api.print({ ...query(), columns: GENERAL_COLUMNS });
    expect(await app.svc.vouchers.list({})).toEqual(before);
    expect(Object.keys(server.router._def.record)).not.toContain('vouchers');
  });
  it('w_zc_zc_1：格式确认/取消/恢复与版本冲突保留，和明细格式独立', async () => {
    const api = app.call(server);
    const change = {
      kind: 'general' as const,
      columns: ['date', 'debit'] as ('date' | 'debit')[],
      confirmed: false,
      expectedRevision: 0,
    };
    expect(await api.saveFormat(change)).toEqual({ columns: GENERAL_COLUMNS, revision: 0 });
    expect(await api.saveFormat({ ...change, confirmed: true })).toEqual({
      columns: change.columns,
      revision: 1,
    });
    await expect(api.saveFormat({ ...change, confirmed: true })).rejects.toThrow(/其他窗口/);
    expect(await api.restoreFormat({ ...change, expectedRevision: 1 })).toEqual({
      columns: change.columns,
      revision: 1,
    });
    expect(await api.restoreFormat({ ...change, expectedRevision: 1, confirmed: true })).toEqual({
      columns: GENERAL_COLUMNS,
      revision: 2,
    });
    expect(await api.format({ kind: 'detail' })).toEqual({ columns: DEFAULT_COLUMNS, revision: 0 });
  });
  it('随机跨月红字：月末=期初+借-贷，年度累计取整分独立手算', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -100000, max: 100000 }).filter((v) => v !== 0),
          { minLength: 2, maxLength: 8 },
        ),
        async (values) => {
          const b = await createTestBook();
          try {
            await seedVouchers(
              b.svc,
              values.map((v, i) => ({
                date: `2026-${i % 2 ? '02' : '01'}-02`,
                status: 'posted',
                lines: [
                  { account: '1001', debit: v },
                  { account: '4001', credit: v },
                ],
              })),
            );
            const report = await ledgersService(b.forModule('ledgers')).report(
              query({ periodFrom: 202601, periodTo: 202602 }),
            );
            const january = values
              .filter((_, i) => i % 2 === 0)
              .reduce((s, n) => s + BigInt(n), 0n);
            const total = values.reduce((s, n) => s + BigInt(n), 0n);
            expect(
              report.rows.filter((r) => r.kind === 'closing').map((r) => r.signedBalance),
            ).toEqual([Number(january), Number(total)]);
            expect(report.rows.filter((r) => r.kind === 'ytd').map((r) => r.debit)).toEqual([
              Number(january),
              Number(total),
            ]);
          } finally {
            await b.close();
          }
        },
      ),
      { numRuns: 8 },
    );
  });
});

it('w_zc_zc：合法已建期间可查；缺202701明确阻止且查询不补期间或静默补零', async () => {
  await seedVouchers(app.svc, [
    {
      date: '2026-07-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: 1 },
        { account: '4001', credit: 1 },
      ],
    },
  ]);
  const api = app.call(server);
  const periods = await app.svc.periods.list();
  expect((await api.report(query())).rows.length).toBeGreaterThan(0);
  await expect(api.report(query({ periodTo: 202701 }))).rejects.toThrow(/2027年01月/);
  expect(await app.svc.periods.list()).toEqual(periods);
  await app.svc.periods.ensureYear(2027);
  expect(
    (await api.report(query({ periodTo: 202701 }))).rows.filter((row) => row.kind === 'month'),
  ).toHaveLength(7);
});
