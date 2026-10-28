import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { parseCodeScheme } from '@caiwu/core';
import { createTestApp, createTestBook, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { buildMultiReport, validateMultiColumns } from '../server/multicolumn';
import { ledgersService } from '../server/service';
import { DEFAULT_COLUMNS, QuerySchema, type LedgerQuery, type MultiColumn } from '../shared';
import { seedMultiBook } from './multicolumn-seed';

const query = (patch: Partial<LedgerQuery> = {}): LedgerQuery =>
  QuerySchema.parse({
    kind: 'multi',
    periodFrom: 202602,
    periodTo: 202602,
    account: '6601',
    ...patch,
  });
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});

describe('w_zc_dlz/w_zc_fhdlz 多栏账与辅助多栏账', () => {
  it('w_zc_dlz_1：直属下级自动分栏，期初、逐笔、月计和全年累计整分一致', async () => {
    await seedMultiBook(app.svc);
    const report = await app.call(server).report(query());
    expect(report.entryCount).toBe(5);
    expect(report.dynamicColumns?.map((c) => c.label)).toEqual([
      '660101 差旅费（借减贷）',
      '660102 办公费（借减贷）',
    ]);
    const [travel, office] = report.dynamicColumns!.map((c) => c.id);
    const opening = report.rows[0]!;
    expect(opening).toMatchObject({
      signedBalance: 1300,
      values: { [travel!]: 600, [office!]: 700 },
    });
    const month = report.rows.find((r) => r.kind === 'month')!;
    expect(month).toMatchObject({
      debit: 770,
      credit: 50,
      signedBalance: 2020,
      values: { [travel!]: 340, [office!]: 380 },
    });
    expect(report.rows.find((r) => r.kind === 'ytd')).toMatchObject({
      debit: 870,
      credit: 50,
      values: { [travel!]: 440, [office!]: 380 },
    });
    expect(report.rows.at(-1)).toMatchObject({
      signedBalance: 2020,
      values: { [travel!]: 940, [office!]: 1080 },
    });
    expect(new Set(report.rows.map((r) => r.sectionKey)).size).toBe(1);
    const red = report.rows.find((r) => r.debit === -20)!;
    expect(red.values![office!]).toBe(-20);
    expect(
      report.rows.filter((r) => r.kind === 'entry').every((r) => !!r.href && !!r.voucherId),
    ).toBe(true);
  });

  it('w_zc_fhdlz_1：每个辅助对象独立承接期初，未指定对象不漏掉余额', async () => {
    const { departmentId } = await seedMultiBook(app.svc);
    const api = app.call(server);
    const report = await api.report(
      query({ kind: 'auxiliary-multi', dimensionType: 'department' }),
    );
    const closing = report.rows.filter((r) => r.kind === 'closing');
    expect(closing).toHaveLength(3);
    expect(closing.find((r) => r.dimensions.includes('未指定'))?.signedBalance).toBe(790);
    expect(closing.map((r) => r.signedBalance).sort((a, b) => a! - b!)).toEqual([380, 790, 850]);
    expect(closing.reduce((s, r) => s + r.signedBalance!, 0)).toBe(2020);
    expect(new Set(report.rows.map((r) => r.sectionKey)).size).toBe(3);
    const filtered = await api.report(
      query({
        kind: 'auxiliary-multi',
        dimensionType: 'department',
        dimensions: { department: departmentId },
      }),
    );
    expect(filtered.entryCount).toBe(2);
    expect(filtered.rows.at(-1)?.signedBalance).toBe(850);
    expect(new Set(filtered.rows.map((r) => r.sectionKey)).size).toBe(1);
  });

  it('w_zc_dlz_1：包含未过账只加入待审核和已审核，排除草稿作废', async () => {
    await seedMultiBook(app.svc);
    const report = await app.call(server).report(query({ includeUnposted: true }));
    expect(report.entryCount).toBe(7);
    expect(report.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 795,
      credit: 50,
      signedBalance: 2045,
    });
    expect(new Set(report.rows.filter((r) => r.kind === 'entry').map((r) => r.status))).toEqual(
      new Set(['已过账', '已审核', '待审核']),
    );
  });

  it('w_zc_dlz：拒绝明细科目、未选科目、科目范围及不适用的辅助类型', async () => {
    await seedMultiBook(app.svc);
    for (const patch of [
      { account: '660102' },
      { account: '' },
      { accountTo: '6602' },
      { kind: 'auxiliary-multi' as const, dimensionType: 'partner' as const },
    ])
      await expect(app.call(server).report(query(patch))).rejects.toThrow();
    await expect(app.call(server).report(query({ account: '99999' }))).rejects.toThrow(/不存在/);
  });

  it('w_zc_dlz_1：自定义借贷和净额栏目持久保存，不重算未覆盖科目', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const columns: MultiColumn[] = [
      { id: 'travel_debit', label: '差旅借方', accountCodes: ['660101'], side: 'debit' },
      { id: 'travel_credit', label: '差旅贷方', accountCodes: ['66010101'], side: 'credit' },
    ];
    expect(
      await api.saveMultiFormat({
        kind: 'multi',
        account: '6601',
        columns,
        expectedRevision: 0,
        confirmed: true,
      }),
    ).toMatchObject({ columns, revision: 1 });
    expect(await api.multiFormat({ kind: 'multi', account: '6601' })).toMatchObject({
      columns,
      revision: 1,
    });
    const report = await api.report(query({ multiMode: 'custom' }));
    const month = report.rows.find((r) => r.kind === 'month')!;
    expect(month.values).toEqual({
      multi_travel_debit: 390,
      multi_travel_credit: 50,
      multi__remainder: 380,
    });
    expect(report.rows[0]!.values).toEqual({
      multi_travel_debit: null,
      multi_travel_credit: null,
      multi__remainder: 700,
    });
    expect(report.rows.find((r) => r.kind === 'ytd')!.values).toEqual({
      multi_travel_debit: 490,
      multi_travel_credit: 50,
      multi__remainder: 380,
    });
    expect((await api.multiFormat({ kind: 'auxiliary-multi', account: '6601' })).columns).toEqual(
      [],
    );
    const exported = await api.export({
      ...query({ multiMode: 'custom' }),
      columns: DEFAULT_COLUMNS,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(exported.base64, 'base64')).buffer);
    const values = workbook.worksheets[0]!.getRow(2).values;
    expect(values).toContain('差旅借方（借方）');
    expect(values).toContain('其他未分栏科目（借减贷）');
  });

  it('w_zc_dlz_1：重复覆盖、越界和坏栏目拒绝，失败保存不损失原配置', async () => {
    await seedMultiBook(app.svc);
    const accounts = await app.svc.accounts.list();
    const c = (
      id: string,
      accountCodes: string[],
      side: MultiColumn['side'] = 'net',
    ): MultiColumn => ({ id, label: id, accountCodes, side });
    for (const columns of [
      [c('a', ['660101', '66010101'])],
      [c('a', ['660101']), c('b', ['66010101'])],
      [c('a', ['660101'], 'debit'), c('b', ['66010101'], 'net')],
      [c('a', ['6601'])],
      [c('a', ['1001'])],
      [c('a', ['NOPE'])],
    ])
      expect(() => validateMultiColumns(accounts, '6601', columns)).toThrow();
    expect(() =>
      validateMultiColumns(accounts, '6601', [
        c('a', ['660101'], 'debit'),
        c('b', ['66010101'], 'credit'),
      ]),
    ).not.toThrow();
    const api = app.call(server);
    const columns = [c('a', ['660101'])];
    await api.saveMultiFormat({
      kind: 'multi',
      account: '6601',
      columns,
      expectedRevision: 0,
      confirmed: true,
    });
    await expect(
      api.saveMultiFormat({
        kind: 'multi',
        account: '6601',
        columns: [c('a', ['1001'])],
        expectedRevision: 1,
        confirmed: true,
      }),
    ).rejects.toThrow();
    expect(await api.multiFormat({ kind: 'multi', account: '6601' })).toEqual({
      columns,
      revision: 1,
    });
    await expect(
      api.saveMultiFormat({
        kind: 'multi',
        account: '6601',
        columns,
        expectedRevision: 0,
        confirmed: true,
      }),
    ).rejects.toThrow(/其他窗口/);
    expect(
      await api.saveMultiFormat({
        kind: 'multi',
        account: '6601',
        columns: [],
        expectedRevision: 1,
        confirmed: false,
      }),
    ).toEqual({ columns, revision: 1 });
  });

  it('w_zc_dlz_1：自定义未设置需明确提示，配置权限独立，空输出拒绝', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    await expect(api.report(query({ multiMode: 'custom' }))).rejects.toThrow(/没有设置自定义栏目/);
    const viewer = app.call(
      server,
      await app.addUser('multi_viewer', { permissions: ['ledgers.view'] }),
    );
    await expect(
      viewer.saveMultiFormat({
        kind: 'multi',
        account: '6601',
        columns: [],
        expectedRevision: 0,
        confirmed: true,
      }),
    ).rejects.toThrow(/权限/);
    const q = query({ account: '2221' });
    expect((await api.report(q)).rows).toEqual([]);
    await expect(api.export({ ...q, columns: DEFAULT_COLUMNS })).rejects.toThrow(/没有账簿记录/);
  });

  it('w_zc_dlz_1：本位币和外币筛选同core口径，外币金额不混成栏目余额', async () => {
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '100201', debit: 500 },
          { account: '4001', credit: 500 },
        ],
      },
      {
        date: '2026-02-02',
        status: 'posted',
        lines: [
          { account: '100202', debit: 710, currency: 'USD', fcAmount: 100, rate: '7.1' },
          { account: '4001', credit: 710 },
        ],
      },
    ]);
    const api = app.call(server);
    expect(
      (await api.report(query({ account: '1002', currency: 'CNY' }))).rows.at(-1)?.signedBalance,
    ).toBe(500);
    const usd = await api.report(query({ account: '1002', currency: 'USD' }));
    expect(usd.rows.at(-1)?.signedBalance).toBe(710);
    expect(Object.values(usd.rows.at(-1)!.values!)).toEqual([0, 710]);
  });

  it('w_zc_dlz_1：期中启用累计只计一次、跨年重置、缺失期间不可补零', async () => {
    const book = await createTestBook({ startMonth: 7 });
    try {
      const account = await book.svc.accounts.require('100201');
      await book.svc.opening.upsert({
        year: 2026,
        accountId: account.id,
        balance: 500,
        ytdDebit: 1200,
        ytdCredit: 200,
      });
      await seedVouchers(book.svc, [
        {
          date: '2026-07-01',
          status: 'posted',
          lines: [
            { account: '100201', debit: 37 },
            { account: '4001', credit: 37 },
          ],
        },
      ]);
      const service = ledgersService(book.forModule('ledgers'));
      const report = await service.report(
        query({ account: '1002', periodFrom: 202607, periodTo: 202608 }),
      );
      expect(report.rows.filter((r) => r.kind === 'ytd').map((r) => r.debit)).toEqual([1237, 1237]);
      await expect(
        service.report(query({ account: '1002', periodFrom: 202607, periodTo: 202701 })),
      ).rejects.toThrow(/2027年01月/);
      await expect(
        service.report(query({ account: '1002', periodFrom: 202606, periodTo: 202607 })),
      ).rejects.toThrow(/启用期间/);
      await book.svc.periods.ensureYear(2027);
      const next = await service.report(
        query({ account: '1002', periodFrom: 202701, periodTo: 202701 }),
      );
      expect(next.rows[0]?.signedBalance).toBe(537);
      expect(next.rows.find((r) => r.kind === 'ytd')?.debit).toBe(0);
    } finally {
      await book.close();
    }
  });

  it('w_zc_dlz_1：超120月和查询截断拒绝，不把部分分录当成完整账簿', async () => {
    await expect(
      app.call(server).report(query({ account: '1002', periodFrom: 202601, periodTo: 203601 })),
    ).rejects.toThrow(/120/);
    const svc = app.svcFor('ledgers');
    const entries = new Array(200_000).fill({});
    await expect(
      buildMultiReport(
        { ...svc, ledger: { ...svc.ledger, entries: async () => entries } },
        query({ account: '1002' }),
        await svc.accounts.list(),
      ),
    ).rejects.toThrow(/200000/);
  });

  it('w_zc_dlz_1：随机红字各分栏合计等于父科目净发生和逐笔余额', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -100000, max: 100000 }).filter((n) => n !== 0),
          { minLength: 2, maxLength: 8 },
        ),
        async (values) => {
          const book = await createTestBook();
          try {
            const scheme = parseCodeScheme('4-2-2');
            for (const [code, name] of [
              ['660101', '差旅费'],
              ['660102', '办公费'],
            ])
              await book.svc.accounts.create({ code: code!, name: name! }, scheme);
            await seedVouchers(
              book.svc,
              values.map((debit, i) => ({
                date: '2026-02-01',
                status: 'posted',
                lines: [
                  { account: i % 2 ? '660101' : '660102', debit },
                  { account: '4001', credit: debit },
                ],
              })),
            );
            const report = await ledgersService(book.forModule('ledgers')).report(query());
            const net = Number(values.reduce((sum, v) => sum + BigInt(v), 0n));
            const month = report.rows.find((r) => r.kind === 'month')!;
            expect(month.signedBalance).toBe(net);
            expect(
              Object.values(month.values!).reduce<number>((sum, v) => sum + Number(v), 0),
            ).toBe(net);
            expect(report.rows.at(-1)?.signedBalance).toBe(net);
          } finally {
            await book.close();
          }
        },
      ),
      { numRuns: 8 },
    );
  });
});
