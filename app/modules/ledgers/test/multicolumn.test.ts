import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { createTestApp, createTestBook, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { MultiQuerySchema, parseMultiUrl, type MultiQuery } from '../multicolumn';
import { multiService, exportMulti } from '../server/multicolumn';
import { AccountingTemplateSchema } from '@caiwu/core';
import {
  builtinTemplates,
  createCoreServices,
  type CoreDB,
  type CoreServices,
} from '@caiwu/core/server';
import { openDatabase } from '@caiwu/db';
import { seedMultiBook } from './multicolumn-seed';

const query = (patch: Partial<MultiQuery> = {}): MultiQuery => ({
  account: '4999',
  periodFrom: 202607,
  periodTo: 202608,
  mode: 'net',
  includeUnposted: false,
  includeEmpty: false,
  ...patch,
});
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], startMonth: 7 });
});
afterEach(async () => {
  await app.close();
});

describe('w_zc_dlz/w_zc_dlz_1 自动下级分栏', () => {
  it('上级直属分栏汇总三级末级，逐笔/月/累计与core相勾稽，红字不变号', async () => {
    const seed = await seedMultiBook(app.svc);
    const report = await app.call(server).multiReport(query());
    expect(report.columns.map((c) => c.code)).toEqual(['499901', '499902']);
    expect(report.entryCount).toBe(4);
    const entry = report.rows.filter((r) => r.kind === 'entry');
    expect(entry.map((r) => r.signedBalance)).toEqual([8000, 6000, 5700, 5800]);
    expect(entry[0]!.href).toBe(`/m/voucher-entry/edit?id=${seed.voucherId}`);
    expect(entry[2]!.debit).toBe(-300);
    expect(entry[3]!.credit).toBe(-100);
    const [a, b] = report.columns;
    const month = report.rows.find((r) => r.kind === 'month')!;
    expect(month).toMatchObject({
      debit: 700,
      credit: 1900,
      signedBalance: 5800,
      side: '借',
      balance: 5800,
    });
    expect(month.values).toEqual({ [a!.id]: -1300, [b!.id]: 100 });
    const ytd = report.rows.find((r) => r.kind === 'ytd')!;
    expect(ytd).toMatchObject({ debit: 7700, credit: 6900 });
    expect(ytd.values).toEqual({ [a!.id]: 2700, [b!.id]: -1900 });
    expect(report.rows.at(-1)!.signedBalance).toBe(5800);
    const core = (
      await app.svc.ledger.balances({
        periodFrom: 202607,
        periodTo: 202607,
        accountCodes: ['4999'],
      })
    ).find((r) => r.accountCode === '4999')!;
    expect(month.signedBalance).toBe(core.closing);
    expect(Object.values(month.values).reduce<number>((s, n) => s + n!, 0)).toBe(
      core.debit - core.credit,
    );
  });
  it('借方/贷方分栏及无数据科目选项使用相同数据，不重复累计父子', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    for (const [mode, amounts] of [
      ['debit', [700, 0, 0]],
      ['credit', [2000, -100, 0]],
    ] as const) {
      const r = await api.multiReport(query({ mode, includeEmpty: true }));
      expect(r.columns.map((c) => c.code)).toEqual(['499901', '499902', '499903']);
      expect(Object.values(r.rows.find((r) => r.kind === 'month')!.values)).toEqual(amounts);
    }
    const included = await api.multiReport(query({ includeUnposted: true }));
    expect(included.entryCount).toBe(6);
    expect(included.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 1200,
      credit: 2100,
      signedBalance: 6100,
    });
  });
  it('期中启用前所有分栏留空、账前YTD只计一次；跨年累计重置', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const report = await api.multiReport(query({ periodFrom: 202606 }));
    const unknown = report.rows[0]!;
    expect(unknown).toMatchObject({ kind: 'unknown', debit: null, credit: null, balance: null });
    expect(Object.values(unknown.values)).toEqual([null, null, null]);
    expect(report.rows.filter((r) => r.kind === 'ytd').map((r) => r.debit)).toEqual([7700, 7700]);
    const crossYear = await api.multiReport(query({ periodFrom: 202612, periodTo: 202701 }));
    expect(crossYear.rows.filter((r) => r.kind === 'month').map((r) => r.signedBalance)).toEqual([
      6000, 5950,
    ]);
    expect(crossYear.rows.filter((r) => r.kind === 'ytd').map((r) => [r.debit, r.credit])).toEqual([
      [7900, 6900],
      [0, 50],
    ]);
  });
  it('w_zc_dlz：未知/末级科目拒绝；期间错误及未支持的筛选不静默忽略', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    await expect(api.multiReport(query({ account: 'NOPE' }))).rejects.toThrow(/不存在/);
    await expect(api.multiReport(query({ account: '49990101' }))).rejects.toThrow(/末级科目/);
    await expect(api.multiReport(query({ periodTo: 202606 }))).rejects.toThrow(/开始期间/);
    await expect(api.multiReport(query({ periodTo: 203608 }))).rejects.toThrow(/120个月/);
    expect(MultiQuerySchema.safeParse({ ...query(), currency: 'USD' }).success).toBe(false);
    for (const raw of [
      { from: '2e5', account: '4999' },
      { includeUnposted: 'yes', account: '4999' },
      { mode: 'eval', account: '4999' },
    ])
      expect(parseMultiUrl(raw, 202607).error).toBeTruthy();
  });
  it('w_zc_dlz_1：无记录时拒绝导出', async () => {
    await expect(app.call(server).multiExport(query({ account: '1002' }))).rejects.toThrow(
      /没有多栏账记录/,
    );
  });
  it.each([9000000000000001, -9000000000000001, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER])(
    '大金额%s分在真实XLSX各栏精确文本回读',
    async (amount) => {
      await app.svc.opening.upsert({
        year: 2026,
        accountId: (await app.svc.accounts.require('100201')).id,
        balance: 0,
        ytdDebit: amount,
      });
      const q = query({ account: '1002', mode: 'debit', periodTo: 202607 });
      const file = await app.call(server).multiExport(q);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
      const sheet = workbook.worksheets[0]!;
      const row = file.report.rows.findIndex((r) => r.kind === 'ytd') + 3;
      const cell = sheet.getRow(row).getCell(9);
      const abs = BigInt(Math.abs(amount));
      expect(cell.value).toBe(
        `${amount < 0 ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`,
      );
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(sheet.rowCount).toBe(file.report.rows.length + 2);
    },
  );
  it('w_zc_dlz_1：真实4-3-2科目表248栏XLSX可回读，第249栏导出拒绝', async () => {
    const base = AccountingTemplateSchema.parse(builtinTemplates[0]);
    const b = await createTestBook({
      templateId: 'multi-wide-synthetic',
      codeScheme: '4-3-2',
      templates: [
        {
          ...base,
          id: 'multi-wide-synthetic',
          name: '合成宽栏科目表',
          codeScheme: '4-3-2',
          accounts: base.accounts.filter((a) => a.code.length === 4),
        },
      ],
    });
    try {
      await b.svc.accounts.create(
        { code: '4999', name: '合成宽栏根', categoryId: 'equity' },
        b.info.codeScheme,
      );
      for (let i = 1; i <= 248; i++)
        await b.svc.accounts.create(
          { code: `4999${String(i).padStart(3, '0')}`, name: `合成分栏${i}` },
          b.info.codeScheme,
        );
      const q = query({ includeEmpty: true, periodTo: 202607 });
      const file = await exportMulti(b.forModule('ledgers'), q);
      expect(file.report.columns).toHaveLength(248);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
      expect(workbook.worksheets[0]!.columnCount).toBe(256);
      await b.svc.accounts.create({ code: '4999249', name: '合成第249分栏' }, b.info.codeScheme);
      expect((await multiService(b.forModule('ledgers')).report(q)).columns).toHaveLength(249);
      await expect(exportMulti(b.forModule('ledgers'), q)).rejects.toThrow(/248/);
    } finally {
      await b.close();
    }
  });
  it('真实双SQLite连接：读取分录后并发过账不会混入当前余额快照', async () => {
    await seedMultiBook(app.svc);
    const connection = openDatabase<CoreDB>(app.runtime.bookStore.open(app.book.id).file);
    const base = app.svcFor('ledgers');
    const writer = createCoreServices({ ...base.ctx, db: connection.db, moduleId: null });
    let release!: () => void;
    const signal = new Promise<void>((resolve) => {
      release = resolve;
    });
    const written = (async () => {
      await signal;
      await seedVouchers(writer, [
        {
          date: '2026-07-11',
          status: 'posted',
          lines: [
            { account: '499902', debit: 100 },
            { account: '4001', credit: 100 },
          ],
        },
      ]);
    })();
    const reader: CoreServices = {
      ...base,
      tx: (fn) =>
        base.tx((t) =>
          fn({
            ...t,
            ledger: {
              ...t.ledger,
              entries: async (q) => {
                const rows = await t.ledger.entries(q);
                release();
                await written;
                return rows;
              },
            },
          }),
        ),
    };
    try {
      const before = await multiService(reader).report(query());
      expect(before.entryCount).toBe(4);
      expect(before.rows.at(-1)!.signedBalance).toBe(5800);
      const after = await app.call(server).multiReport(query());
      expect(after.entryCount).toBe(5);
      expect(after.rows.at(-1)!.signedBalance).toBe(5900);
    } finally {
      release();
      await written;
      await connection.close();
    }
  });
  it('单侧累计安全而借减贷超范围时明确拒绝净额，不影响安全单侧取数', async () => {
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require('100201')).id,
      balance: 0,
      ytdDebit: Number.MAX_SAFE_INTEGER,
      ytdCredit: -1,
    });
    const q = query({ account: '1002' });
    await expect(app.call(server).multiReport(q)).rejects.toThrow(/安全整数/);
    await expect(app.call(server).multiExport(q)).rejects.toThrow(/安全整数/);
    const debit = await app.call(server).multiReport({ ...q, mode: 'debit' });
    expect(Object.values(debit.rows.find((r) => r.kind === 'ytd')!.values)).toEqual([
      Number.MAX_SAFE_INTEGER,
    ]);
  });
  it('实际累计超过安全范围拒绝查询和导出', async () => {
    await seedVouchers(
      app.svc,
      [1, 2].map(() => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '100201', debit: 4_600_000_000_000_001 },
          { account: '4001', credit: 4_600_000_000_000_001 },
        ],
      })),
    );
    const q = query({ account: '1002' });
    await expect(app.call(server).multiReport(q)).rejects.toThrow(/安全整数/);
    await expect(app.call(server).multiExport(q)).rejects.toThrow(/安全整数/);
  });
  it('服务端查看/导出权限独立，读取输出不改凭证', async () => {
    await seedMultiBook(app.svc);
    const before = await app.svc.vouchers.list({});
    const denied = app.call(server, await app.addUser('denied'));
    await expect(denied.multiReport(query())).rejects.toThrow(/权限/);
    const viewer = app.call(server, await app.addUser('viewer', { permissions: ['ledgers.view'] }));
    expect((await viewer.multiReport(query())).entryCount).toBe(4);
    await expect(viewer.multiExport(query())).rejects.toThrow(/权限/);
    const exporter = app.call(
      server,
      await app.addUser('exporter', { permissions: ['ledgers.export'] }),
    );
    await expect(exporter.multiExport(query())).rejects.toThrow(/权限/);
    await app.call(server).multiExport(query());
    expect(await app.svc.vouchers.list({})).toEqual(before);
  });
  it('105笔实际分录跨分页仍全部计入月小计和XLSX', async () => {
    await seedVouchers(
      app.svc,
      Array.from({ length: 105 }, (_, i) => ({
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '100201', debit: i + 1 },
          { account: '4001', credit: i + 1 },
        ],
      })),
    );
    const file = await app.call(server).multiExport(query({ account: '1002' }));
    expect(file.report.entryCount).toBe(105);
    expect(file.report.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 5565,
      signedBalance: 5565,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
    expect(workbook.worksheets[0]!.rowCount).toBe(file.report.rows.length + 2);
  });
  it('随机红字末级分录：分栏净额之和=根发生净额，逐笔余额保持整数', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -10000, max: 10000 }).filter((v) => v !== 0),
          { minLength: 1, maxLength: 7 },
        ),
        async (values) => {
          const b = await createTestBook();
          try {
            await seedVouchers(
              b.svc,
              values.map((v, i) => ({
                date: '2026-07-01',
                status: 'posted',
                lines: [
                  {
                    account: i % 2 ? '100202' : '100201',
                    debit: v,
                    ...(i % 2 ? { currency: 'USD', rate: '1', fcAmount: v } : {}),
                  },
                  { account: '4001', credit: v },
                ],
              })),
            );
            const r = await multiService(b.forModule('ledgers')).report(
              query({ account: '1002', periodTo: 202607 }),
            );
            const expected = values.reduce((s, v) => s + BigInt(v), 0n);
            const month = r.rows.find((r) => r.kind === 'month')!;
            expect(month.signedBalance).toBe(Number(expected));
            expect(Object.values(month.values).reduce((s: bigint, v) => s + BigInt(v!), 0n)).toBe(
              expected,
            );
          } finally {
            await b.close();
          }
        },
      ),
      { numRuns: 8 },
    );
  });
});
