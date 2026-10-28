import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestApp, seedVouchers, type TestApp, type VoucherSpec } from '@caiwu/testkit';
import server from '../server';
import { DEFAULT_COLUMNS, QuerySchema, type LedgerQuery } from '../shared';
import { VatColumnsSchema, type VatColumn } from '../vat-shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => {
  await app.close();
});
const query = (patch: Partial<LedgerQuery> = {}) =>
  QuerySchema.parse({ kind: 'vat', periodFrom: 202602, periodTo: 202602, ...patch });
const standard: VatColumn[] = [
  { id: 'input', label: '进项税额', side: 'debit', accountCodes: ['22210101'] },
  { id: 'output', label: '销项税额', side: 'credit', accountCodes: ['22210102'] },
];
const save = (columns: VatColumn[] = standard, expectedRevision = 0, confirmed = true) =>
  app.call(server).vat.saveMapping({ columns, expectedRevision, confirmed });
async function seed() {
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('22210101')).id,
    balance: 1000,
  });
  await app.svc.opening.upsert({
    year: 2026,
    accountId: (await app.svc.accounts.require('22210102')).id,
    balance: -2000,
  });
  const one = (
    date: string,
    account: string,
    debit: number,
    credit: number,
    status: VoucherSpec['status'] = 'posted',
  ): VoucherSpec => ({
    date,
    status,
    summary: `合成税额 ${debit || -credit}`,
    lines: [
      { account, debit, credit },
      { account: '4001', debit: credit, credit: debit },
    ],
  });
  const vouchers = await seedVouchers(app.svc, [
    one('2026-01-05', '22210101', 100, 0),
    one('2026-01-06', '22210102', 0, 300),
    one('2026-02-01', '22210101', 500, 0),
    one('2026-02-02', '22210102', 0, 800),
    one('2026-02-03', '22210101', 0, 50),
    one('2026-02-04', '22210102', 20, 0),
    one('2026-02-05', '22210101', -10, 0),
    one('2026-02-06', '22210101', 100, 0, 'pending'),
    one('2026-02-07', '22210101', 200, 0, 'audited'),
    one('2026-02-08', '22210101', 999, 0, 'draft'),
    one('2026-02-09', '22210101', 888, 0, 'pending'),
  ]);
  await app.svc.vouchers.setVoided(vouchers.at(-1)!.id, true);
}

describe('增值税明细账与对应科目设置', () => {
  it('w_xt_tz_zc_zzsmxz/w_zc_zzs：未映射明确阻止，取消设置不落盘，首次保存后可读', async () => {
    const api = app.call(server);
    expect(await api.vat.mapping()).toEqual({ columns: [], revision: 0 });
    await expect(api.report(query())).rejects.toThrow(/尚未设置/);
    expect(await save(standard, 0, false)).toEqual({ columns: [], revision: 0 });
    const config = await save();
    expect(config).toEqual({ columns: standard, revision: 1 });
    expect(await api.vat.mapping()).toEqual(config);
  });
  it('w_zc_zzs：期初、逐笔、分类月计、累计和期末均与手算一致，反向发生不丢失', async () => {
    await seed();
    await save();
    const report = await app.call(server).report(query());
    expect(report.entryCount).toBe(5);
    expect(report.rows[0]).toMatchObject({
      kind: 'opening',
      signedBalance: -1200,
      side: '贷',
      balance: 1200,
    });
    const running = report.rows.filter((r) => r.kind === 'entry').map((r) => r.signedBalance);
    expect(running).toEqual([-700, -1500, -1550, -1530, -1540]);
    expect(report.rows.find((r) => r.kind === 'month')).toMatchObject({
      debit: 510,
      credit: 850,
      signedBalance: -1540,
      values: {
        vat_input: 490,
        vat_output: 800,
        vat_unclassified_debit: 20,
        vat_unclassified_credit: 50,
      },
    });
    expect(report.rows.find((r) => r.kind === 'ytd')).toMatchObject({
      debit: 610,
      credit: 1150,
      values: {
        vat_input: 590,
        vat_output: 1100,
        vat_unclassified_debit: 20,
        vat_unclassified_credit: 50,
      },
    });
    expect(report.rows.at(-1)).toMatchObject({ kind: 'closing', signedBalance: -1540 });
    expect(report.dynamicColumns?.map((c) => c.label)).toEqual([
      '借方·进项税额',
      '贷方·销项税额',
      '未分类借方',
      '未分类贷方',
    ]);
    expect(report.rows.find((r) => r.debit === -10)?.values?.vat_input).toBe(-10);
    expect(
      report.rows
        .filter((r) => r.kind === 'entry')
        .every((r) => r.href?.startsWith('/m/voucher-entry/edit?id=')),
    ).toBe(true);
    expect(new Set(report.rows.map((r) => r.sectionKey))).toEqual(new Set(['vat']));
    const unposted = await app.call(server).report(query({ includeUnposted: true }));
    expect(unposted.entryCount).toBe(7);
    expect(unposted.rows.at(-1)?.signedBalance).toBe(-1240);
  });
  it('w_xt_tz_zc_zzsmxz：父子和同侧重复映射拒绝；相同科目分别借贷映射不重算余额', async () => {
    await seed();
    await expect(save([{ ...standard[0]!, accountCodes: ['222101', '22210101'] }])).rejects.toThrow(
      /重复计算/,
    );
    await expect(
      save([
        { ...standard[0]!, accountCodes: ['222101'] },
        { ...standard[1]!, side: 'debit' },
      ]),
    ).rejects.toThrow(/重复计算/);
    expect((await app.call(server).vat.mapping()).revision).toBe(0);
    await save([
      { id: 'debit', label: '借方全部', side: 'debit', accountCodes: ['222101'] },
      { id: 'credit', label: '贷方全部', side: 'credit', accountCodes: ['222101'] },
    ]);
    const report = await app.call(server).report(query());
    expect(report.rows.at(-1)?.signedBalance).toBe(-1540);
    expect(report.rows.find((r) => r.kind === 'month')?.values).toMatchObject({
      vat_debit: 510,
      vat_credit: 850,
    });
    expect(report.dynamicColumns).toHaveLength(2);
  });
  it('w_xt_tz_zc_zzsmxz：错误科目、重复栏目和超过五个同侧栏目均拒绝，旧设置保留', async () => {
    const original = await save();
    await expect(save([{ ...standard[0]!, accountCodes: ['9999'] }], 1)).rejects.toThrow(/不存在/);
    await expect(save([standard[0]!, { ...standard[0]!, label: '其他名称' }], 1)).rejects.toThrow(
      /编号不能重复/,
    );
    expect(
      VatColumnsSchema.safeParse(
        Array.from({ length: 6 }, (_, i) => ({
          id: `c${i}`,
          label: `分类${i}`,
          side: 'debit',
          accountCodes: ['222101'],
        })),
      ).success,
    ).toBe(false);
    await expect(save([{ ...standard[0]!, id: 'unclassified_debit' }], 1)).rejects.toThrow(/保留/);
    expect(await app.call(server).vat.mapping()).toEqual(original);
  });
  it('w_xt_tz_zc_zzsmxz：修改版本过期拒绝，取消和失败不覆盖已保存内容', async () => {
    const original = await save();
    await expect(save([{ ...standard[0]!, label: '过期修改' }], 0)).rejects.toThrow(/其他窗口修改/);
    expect(await save([{ ...standard[0]!, label: '取消修改' }], 0, false)).toEqual(original);
    expect(await app.call(server).vat.mapping()).toEqual(original);
  });
  it('w_xt_tz_zc_zzsmxz/w_zc_zzs：设置与读取分别校验服务端权限，打印和导出也需查看权限', async () => {
    const view = app.call(server, await app.addUser('vat_view', { permissions: ['ledgers.view'] }));
    await expect(
      view.vat.saveMapping({ columns: standard, expectedRevision: 0, confirmed: true }),
    ).rejects.toThrow(/权限/);
    const denied = app.call(server, await app.addUser('vat_none'));
    await expect(denied.vat.mapping()).rejects.toThrow(/权限/);
    await save();
    await seed();
    const printOnly = app.call(
      server,
      await app.addUser('vat_printer', { permissions: ['ledgers.print'] }),
    );
    await expect(printOnly.print({ ...query(), columns: DEFAULT_COLUMNS })).rejects.toThrow(/权限/);
    expect((await view.vat.mapping()).revision).toBe(1);
  });
  it('w_zc_zzs：账簿筛选、跨年累计重置、精确Excel和安全打印均使用同一分类取数', async () => {
    await seed();
    await save();
    const api = app.call(server);
    const filtered = await api.report(query({ account: '22210101' }));
    expect(filtered.entryCount).toBe(3);
    expect(filtered.rows.at(-1)?.signedBalance).toBe(1540);
    await app.svc.periods.ensureYear(2027);
    const next = await api.report(query({ periodFrom: 202701, periodTo: 202701 }));
    expect(next.rows.find((r) => r.kind === 'ytd')).toMatchObject({ debit: 0, credit: 0 });
    expect(next.rows.at(-1)?.signedBalance).toBe(-1540);
    const file = await api.export({ ...query(), columns: DEFAULT_COLUMNS });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(2).values).toEqual(
      expect.arrayContaining(['借方·进项税额', '贷方·销项税额', '未分类贷方', '未分类借方']),
    );
    expect(sheet.getRow(sheet.rowCount).values).toContain('15.40');
    const printed = await api.print({
      ...query(),
      columns: DEFAULT_COLUMNS,
      printOptions: { rowsPerPage: 3 },
    });
    expect(printed.html).toContain('进项税额');
    expect(printed.html).toContain('15.40');
    expect(printed.totalPages).toBeGreaterThan(1);
  });
  it('w_zc_zzs/w_preview_zzsmxz：空账簿禁止打印，启用前及未建期间不能伪造账页', async () => {
    await save();
    const api = app.call(server);
    expect((await api.report(query())).rows).toHaveLength(0);
    await expect(api.print({ ...query(), columns: DEFAULT_COLUMNS })).rejects.toThrow(
      /没有账簿记录/,
    );
    await expect(api.report(query({ periodFrom: 202512, periodTo: 202512 }))).rejects.toThrow(
      /启用/,
    );
    await expect(api.report(query({ periodFrom: 202701, periodTo: 202701 }))).rejects.toThrow(
      /期间/,
    );
  });
  it('w_zc_zzs/w_print_2_zw：包含零科目时保留零映射账页，默认仍为空账', async () => {
    await save();
    const api = app.call(server);
    expect((await api.report(query())).rows).toHaveLength(0);
    const report = await api.report(query({ includeZero: true }));
    expect(report.entryCount).toBe(0);
    expect(report.rows.map((row) => row.kind)).toEqual(['opening', 'month', 'ytd', 'closing']);
    expect(report.rows.every((row) => row.signedBalance === 0)).toBe(true);
    const printed = await api.print({ ...query({ includeZero: true }), columns: DEFAULT_COLUMNS });
    expect(printed.html).toContain('期初余额');
    expect(printed.html).toContain('0.00');
  });
});
