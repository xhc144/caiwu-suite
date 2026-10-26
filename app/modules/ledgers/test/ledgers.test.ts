import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import ExcelJS from 'exceljs';
import { createTestApp, createTestBook, seedVouchers, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { assertComplete, ENTRY_LIMIT, ledgersService, safeSum } from '../server/service';
import { DEFAULT_COLUMNS, parseLedgerUrl, type LedgerQuery } from '../shared';
import { seedLedgerBook } from './seed';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
const query = (patch: Partial<LedgerQuery> = {}): LedgerQuery => ({
  kind: 'detail',
  periodFrom: 202602,
  periodTo: 202602,
  account: '1001',
  accountTo: '',
  dimensions: {},
  currency: '',
  includeUnposted: false,
  ...patch,
});
const output = (patch: Partial<LedgerQuery> = {}) => ({
  ...query(patch),
  columns: DEFAULT_COLUMNS,
});

describe('三栏明细账与日记账', () => {
  it('w_zc_slz_1/w_zc_xjrjz_1/w_zc_yhrjz_1：本期零余额零发生仍保留历史本年累计', async () => {
    const api = app.call(server);
    for (const [kind, account] of [
      ['detail', '1001'],
      ['cash', '1001'],
      ['bank', '100201'],
    ] as const) {
      // 同一现金科目只造数一次；所有状态均通过 core 推进到已过账。
      if (kind !== 'cash') {
        await seedVouchers(app.svc, [
          {
            date: '2026-01-05',
            status: 'posted',
            lines: [
              { account, debit: 10_000 },
              { account: '4001', credit: 10_000 },
            ],
          },
          {
            date: '2026-01-06',
            status: 'posted',
            lines: [
              { account, credit: 10_000 },
              { account: '4001', debit: 10_000 },
            ],
          },
        ]);
      }
      const core = await app.svc.ledger.balances({
        periodFrom: 202602,
        periodTo: 202602,
        accountCodes: [account],
        rollup: false,
      });
      expect(core).toHaveLength(1);
      expect(core[0]).toMatchObject({
        opening: 0,
        debit: 0,
        credit: 0,
        closing: 0,
        ytdDebit: 10_000,
        ytdCredit: 10_000,
      });
      const report = await api.report(query({ kind, account }));
      expect(report.entryCount).toBe(0);
      expect(report.rows.map((row) => row.kind)).toEqual(['opening', 'month', 'ytd', 'closing']);
      expect(report.rows.find((row) => row.kind === 'ytd')).toMatchObject({
        debit: 10_000,
        credit: 10_000,
        signedBalance: 0,
        voucherId: null,
        href: null,
      });
      expect(report.rows.find((row) => row.kind === 'month')).toMatchObject({
        debit: 0,
        credit: 0,
      });
      expect(report.rows.at(-1)!.signedBalance).toBe(core[0]!.closing);
    }
  });
  it('w_zc_slz_1：非零期初、前月、同日凭证、同行序、红字和合计独立核对 core', async () => {
    await seedLedgerBook(app.svc);
    const report = await app.call(server).report(query());
    expect(report.rows[0]).toMatchObject({
      kind: 'opening',
      signedBalance: 60_000,
      voucherId: null,
      href: null,
    });
    const entries = report.rows.filter((r) => r.kind === 'entry');
    expect(entries.map((r) => r.signedBalance)).toEqual([62_500, 61_500, 61_300, 61_400, 61_600]);
    expect(entries.map((r) => r.summary)).toEqual([
      '本月收款',
      '本月付款',
      '红字收款',
      '同凭证两行',
      '同凭证两行',
    ]);
    expect(entries.every((r) => r.href === `/m/voucher-entry/edit?id=${r.voucherId}`)).toBe(true);
    expect(
      report.rows
        .filter((r) => r.kind !== 'entry')
        .every((r) => r.voucherId === null && r.href === null),
    ).toBe(true);
    expect(report.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 2_600,
      credit: 1_000,
      signedBalance: 61_600,
    });
    expect(report.rows.find((r) => r.kind === 'ytd')).toMatchObject({
      debit: 12_600,
      credit: 1_000,
    });
    const core = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      accountCodes: ['1001'],
      rollup: false,
    });
    expect(core[0]).toMatchObject({
      opening: 60_000,
      closing: 61_600,
      debit: 2_600,
      credit: 1_000,
    });
    expect(report.rows.at(-1)!.signedBalance).toBe(core[0]!.closing);
  });
  it('w_zc_slz_1：包含待审核/已审核，始终排除草稿与作废，查询不改凭证', async () => {
    await seedLedgerBook(app.svc);
    const before = await app.svc.vouchers.list({});
    const report = await app.call(server).report(query({ includeUnposted: true }));
    expect(report.entryCount).toBe(7);
    expect(report.rows.at(-1)!.signedBalance).toBe(61_700);
    expect(report.scope).toContain('包含未过账');
    expect(report.rows.some((r) => /草稿|作废/.test(r.summary))).toBe(false);
    const core = await app.svc.ledger.balances({
      periodFrom: 202602,
      periodTo: 202602,
      accountCodes: ['1001'],
      includeUnposted: true,
    });
    expect(core[0]!.closing).toBe(61_700);
    expect(await app.svc.vouchers.list({})).toEqual(before);
  });
  it('w_zc_xjrjz_1/w_zc_yhrjz_1：现金银行标志、逐日/月小计和独立科目余额', async () => {
    await seedLedgerBook(app.svc);
    await app.svc.accounts.create(
      { code: '1010', name: '备用现金', isCash: true, categoryId: 'asset' },
      [4, 2, 2],
    );
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '1010', debit: 100 },
          { account: '4001', credit: 100 },
        ],
      },
    ]);
    const cash = await app.call(server).report(query({ kind: 'cash', account: '' }));
    expect(cash.rows.some((r) => r.account.startsWith('1010'))).toBe(true);
    const daily = cash.rows.filter((r) => r.kind === 'day' && r.account.startsWith('1001'));
    expect(daily.map((r) => [r.date, r.debit, r.credit, r.signedBalance])).toEqual([
      ['2026-02-03', 2500, 1000, 61500],
      ['2026-02-04', -200, 0, 61300],
      ['2026-02-06', 300, 0, 61600],
    ]);
    const bank = await app.call(server).report(query({ kind: 'bank', account: '1002' }));
    expect(bank.rows.filter((r) => r.kind === 'closing').map((r) => r.signedBalance)).toEqual([
      -2000, 7100,
    ]);
    expect(bank.rows.every((r) => !r.account.startsWith('1002 '))).toBe(true);
    await expect(app.call(server).report(query({ kind: 'bank' }))).rejects.toThrow(
      /不具有银行标志/,
    );
  });
  it('w_zc_slz/w_zc_xjrjz/w_zc_yhrjz：不存在科目、逆序范围和空查询可恢复', async () => {
    const api = app.call(server);
    for (const kind of ['detail', 'cash', 'bank'] as const) {
      await expect(api.report(query({ kind, account: '9999' }))).rejects.toThrow(
        /科目 9999 不存在/,
      );
    }
    await expect(api.report(query({ account: '4001', accountTo: '1001' }))).rejects.toThrow(
      /起始科目/,
    );
    expect((await api.report(query({ account: '' }))).rows).toEqual([]);
    await expect(api.report(query({ currency: 'XYZ' }))).rejects.toThrow(/币种/);
    await expect(api.report(query({ dimensions: { partner: 999 } }))).rejects.toThrow(/不存在 ID/);
    await expect(api.report(query({ periodTo: 203701 }))).rejects.toThrow(/120 个月/);
  });
  it('w_zc_fhslz/w_zc_slz_fb：数字维度/币种与数量样本的本位币口径，父子不重复', async () => {
    const { partnerId } = await seedLedgerBook(app.svc);
    const receivable = await app
      .call(server)
      .report(query({ account: '1122', dimensions: { partner: partnerId } }));
    expect(receivable.rows[0]!.signedBalance).toBe(500);
    expect(receivable.rows.at(-1)!.signedBalance).toBe(1300);
    expect(receivable.entryCount).toBe(1);
    const usd = await app.call(server).report(query({ account: '1002', currency: 'USD' }));
    expect(usd.entryCount).toBe(1);
    expect(usd.rows.at(-1)!.signedBalance).toBe(7100);
    const baseCurrency = (await app.svc.book.info()).baseCurrency;
    const domestic = await app
      .call(server)
      .report(query({ kind: 'bank', account: '1002', currency: baseCurrency }));
    expect(domestic.entryCount).toBe(1);
    expect(domestic.rows.at(-1)!.signedBalance).toBe(-2000);
    expect(domestic.rows.some((r) => r.summary === '美元收款')).toBe(false);
    const stock = await app.call(server).report(query({ account: '1403' }));
    expect(stock.rows.at(-1)!.signedBalance).toBe(12345);
    const all = await app.call(server).report(query({ account: '', accountTo: '' }));
    const closing = all.rows.filter((r) => r.kind === 'closing');
    expect(closing.filter((r) => r.account.startsWith('1002'))).toHaveLength(2);
  });
  it('w_zc_slz_1：跨月无发生仍保留余额，跨年本年累计重起', async () => {
    await seedLedgerBook(app.svc);
    await app.svc.periods.ensureYear(2027);
    const multi = await app.call(server).report(query({ periodFrom: 202601, periodTo: 202603 }));
    expect(
      multi.rows.filter((r) => r.kind === 'month').map((r) => [r.debit, r.credit, r.signedBalance]),
    ).toEqual([
      [10000, 0, 60000],
      [2600, 1000, 61600],
      [0, 0, 61600],
    ]);
    const next = await app.call(server).report(query({ periodFrom: 202612, periodTo: 202701 }));
    expect(next.rows.filter((r) => r.kind === 'ytd').map((r) => r.debit)).toEqual([12600, 0]);
    expect(next.rows.at(-1)!.signedBalance).toBe(61600);
  });
  it('w_zc_slz_1：格式确认、取消、持久恢复和过期覆盖保护', async () => {
    const api = app.call(server);
    const change = {
      kind: 'detail' as const,
      columns: ['summary', 'balance'] as ('summary' | 'balance')[],
      expectedRevision: 0,
      confirmed: false,
    };
    expect(await api.saveFormat(change)).toEqual({ columns: DEFAULT_COLUMNS, revision: 0 });
    expect(await api.saveFormat({ ...change, confirmed: true })).toEqual({
      columns: change.columns,
      revision: 1,
    });
    expect(await ledgersService(app.svcFor('ledgers')).format('detail')).toEqual({
      columns: change.columns,
      revision: 1,
    });
    expect(await api.restoreFormat({ ...change, expectedRevision: 1 })).toEqual({
      columns: change.columns,
      revision: 1,
    });
    await expect(api.saveFormat({ ...change, confirmed: true })).rejects.toThrow(/其他窗口修改/);
    expect(await api.restoreFormat({ ...change, expectedRevision: 1, confirmed: true })).toEqual({
      columns: DEFAULT_COLUMNS,
      revision: 2,
    });
    expect(await app.svc.settings.get('format.detail', null)).toBeNull();
  });
  it('w_zc_slz_1：只读用户不能改格式、导出/打印需独立权限，导出仍需查看权限', async () => {
    const viewer = app.call(server, await app.addUser('viewer', { permissions: ['ledgers.view'] }));
    expect((await viewer.report(query())).rows).toEqual([]);
    const change = {
      kind: 'detail' as const,
      columns: DEFAULT_COLUMNS,
      expectedRevision: 0,
      confirmed: true,
    };
    await expect(viewer.saveFormat(change)).rejects.toThrow(/权限/);
    await expect(viewer.restoreFormat(change)).rejects.toThrow(/权限/);
    await expect(viewer.export(output())).rejects.toThrow(/权限/);
    await expect(viewer.print(output())).rejects.toThrow(/权限/);
    const exportOnly = app.call(
      server,
      await app.addUser('exporter', { permissions: ['ledgers.export'] }),
    );
    await expect(exportOnly.export(output())).rejects.toThrow(/权限/);
    expect(Object.keys(server.router._def.record)).not.toContain('vouchers');
  });
  it('w_zc_slz_1/w_zc_saveas：空打印阻止、xlsx可读且严格对应显示列，重复导出无写入', async () => {
    const api = app.call(server);
    await expect(api.print(output())).rejects.toThrow(/没有账簿记录/);
    await expect(api.export(output())).rejects.toThrow(/没有账簿记录/);
    await seedLedgerBook(app.svc);
    const before = await api.report(query());
    const request = {
      ...query(),
      columns: ['summary', 'debit', 'balance'] as ('summary' | 'debit' | 'balance')[],
    };
    for (let i = 0; i < 2; i++) {
      const file = await api.export(request);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.rowCount).toBe(before.rows.length + 2);
      expect([1, 2, 3].map((i) => sheet.getRow(2).getCell(i).value)).toEqual([
        '摘要',
        '借方',
        '余额',
      ]);
      expect([1, 2, 3].map((i) => sheet.getRow(3).getCell(i).value)).toEqual([
        '期初余额',
        '',
        '600.00',
      ]);
      expect(sheet.getRow(6).getCell(2).value).toBe('-2.00');
    }
    const print = await api.print(request);
    expect(print.html).toContain('<th>摘要</th><th>借方</th><th>余额</th>');
    expect(print.html).toContain('600.00');
    expect(await api.report(query())).toEqual(before);
  });
  it('w_zc_slz_1：地址契约严格验证，不可解析 dims 和非法值可恢复', () => {
    expect(
      parseLedgerUrl(
        {
          account: '1122',
          from: '202602',
          to: '202603',
          dims: '{"partner":1}',
          currency: 'USD',
          includeUnposted: '1',
        },
        202601,
        'detail',
      ).query,
    ).toMatchObject({ account: '1122', dimensions: { partner: 1 }, includeUnposted: true });
    for (const dims of ['{', 'null', '[]', '{"partner":"1"}', '{"other":1}'])
      expect(parseLedgerUrl({ dims }, 202601, 'detail').error).toBeTruthy();
    for (const from of ['NaN', '202613', '2e5', '2026.01'])
      expect(parseLedgerUrl({ from }, 202601, 'detail').error).toBeTruthy();
    expect(parseLedgerUrl({ includeUnposted: 'yes' }, 202601, 'detail').error).toBeTruthy();
    expect(parseLedgerUrl({}, 202603, 'bank').query).toMatchObject({
      periodFrom: 202603,
      periodTo: 202603,
      kind: 'bank',
    });
  });
  it('w_zc_slz_1：分录达到上限拒绝假完整账簿，金额溢出拒绝', () => {
    expect(() => assertComplete(ENTRY_LIMIT)).toThrow(/200000/);
    expect(() => assertComplete(ENTRY_LIMIT - 1)).not.toThrow();
    expect(() => safeSum([Number.MAX_SAFE_INTEGER, 1])).toThrow(/安全整数/);
  });
  it('w_zc_slz_1：随机红字分录逐笔余额 = 整数期初 + 借 - 贷', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.integer({ min: -10000, max: 10000 }).filter((n) => n !== 0),
          { minLength: 1, maxLength: 7 },
        ),
        async (values) => {
          const book = await createTestBook();
          try {
            await book.svc.opening.upsert({
              year: 2026,
              accountId: (await book.svc.accounts.require('1001')).id,
              balance: 12345,
            });
            await seedVouchers(
              book.svc,
              values.map((value) => ({
                date: '2026-02-01',
                status: 'posted' as const,
                lines: [
                  { account: '1001', debit: value },
                  { account: '4001', credit: value },
                ],
              })),
            );
            const report = await ledgersService(book.forModule('ledgers')).report(query());
            let expected = 12345;
            const running = values.map((value) => (expected += value));
            expect(
              report.rows.filter((r) => r.kind === 'entry').map((r) => r.signedBalance),
            ).toEqual(running);
            expect(report.rows.at(-1)!.signedBalance).toBe(expected);
          } finally {
            await book.close();
          }
        },
      ),
      { numRuns: 8 },
    );
  });
});
