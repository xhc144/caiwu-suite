import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  createTestApp,
  createTestBook,
  seedVouchers,
  voucherInputFromSpec,
  type TestApp,
} from '@caiwu/testkit';
import { openDatabase } from '@caiwu/db';
import { createCoreServices, type CoreDB } from '@caiwu/core/server';
import path from 'node:path';
import { multiFormatService } from '../server/multicolumn-format';
import { multiService, exportMulti } from '../server/multicolumn';
import { type MultiColumnDefinition, type MultiQuery, parseMultiUrl } from '../multicolumn';
import server from '../server';
import { seedMultiBook } from './multicolumn-seed';

const columns: MultiColumnDefinition[] = [
  { name: '组合借方', accountCodes: ['49990101', '499902'], mode: 'debit' },
  { name: '第一分栏贷方', accountCodes: ['499901'], mode: 'credit' },
  { name: '全部净额', accountCodes: ['4999'], mode: 'net' },
];
const query = (patch: Partial<MultiQuery> = {}): MultiQuery => ({
  account: '4999',
  periodFrom: 202607,
  periodTo: 202607,
  mode: 'debit',
  includeUnposted: false,
  includeEmpty: false,
  columns,
  ...patch,
});
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server], startMonth: 7 });
});
afterEach(async () => {
  await app.close();
});

describe('w_zc_dlz_1/w_zc_fhdlz_1 自定义栏目与格式', () => {
  it('w_zc_dlz_1：自定义格式不把无数据条件变成零账页，导出仍拒绝空记录', async () => {
    const api = app.call(server);
    const q = query({
      account: '1002',
      columns: [{ name: '合成空栏目', accountCodes: ['100201'], mode: 'debit' }],
    });
    const report = await api.multiPreview(q);
    expect(report.columns).toHaveLength(1);
    expect(report.rows).toEqual([]);
    await expect(api.multiExportFile(q)).rejects.toThrow(/没有多栏账记录/);
    const included = await api.multiPreview({ ...q, includeEmpty: true });
    expect(included.rows.map((r) => r.kind)).toEqual(['opening', 'month', 'ytd', 'closing']);
    expect(included.rows.at(-1)!.signedBalance).toBe(0);
  });
  it('分栏科目集合独立取借贷及净额，逐笔与月/累计精确一致，主账仍覆盖完整上级', async () => {
    await seedMultiBook(app.svc);
    const report = await app.call(server).multiReport(query());
    expect(
      report.rows.filter((r) => r.kind === 'entry').map((r) => Object.values(r.values)),
    ).toEqual([
      [1000, 0, 1000],
      [0, 2000, -2000],
      [-300, 0, -300],
      [0, 0, 100],
    ]);
    expect(Object.values(report.rows.find((r) => r.kind === 'month')!.values)).toEqual([
      700, 2000, -1200,
    ]);
    expect(Object.values(report.rows.find((r) => r.kind === 'ytd')!.values)).toEqual([
      7700, 3000, 800,
    ]);
    expect(report.rows.at(-1)!.signedBalance).toBe(5800);
    const subset = await app.call(server).multiReport(query({ columns: [columns[0]!] }));
    expect(subset.rows.at(-1)!.signedBalance).toBe(5800);
    expect(report.scope).toContain('不能相加');
  });
  it('自定义栏启用前留空，跨年累计重置', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const report = await api.multiReport(query({ periodFrom: 202606, periodTo: 202607 }));
    expect(Object.values(report.rows[0]!.values)).toEqual([null, null, null]);
    const cross = await api.multiReport(query({ periodFrom: 202612, periodTo: 202701 }));
    expect(cross.rows.filter((r) => r.kind === 'ytd').map((r) => Object.values(r.values))).toEqual([
      [7900, 3000, 1000],
      [0, 50, -50],
    ]);
  });
  it('拒绝不存在/范围外科目、同栏重复或父子重叠及重名；不限制不同栏独立取数', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    for (const codes of [['1001'], ['NOPE'], ['499901', '49990101'], ['499902', '499902']]) {
      await expect(
        api.multiReport(query({ columns: [{ ...columns[0]!, accountCodes: codes }] })),
      ).rejects.toThrow(/范围|重叠/);
    }
    await expect(api.multiReport(query({ columns: [columns[0]!, columns[0]!] }))).rejects.toThrow(
      /名称不能重复/,
    );
    await expect(
      api.multiReport(query({ columns: [{ ...columns[0]!, name: '  ' }] })),
    ).rejects.toThrow(/栏目名称/);
  });
  it('确认保存/取消/版本冲突/恢复标准真实持久化；查询不偷偷套用另一窗口的格式', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const input = { account: '4999', columns, expectedRevision: 0, confirmed: false };
    expect(await api.saveMultiFormat(input)).toEqual({ columns: null, revision: 0 });
    const first = await api.saveMultiFormat({ ...input, confirmed: true });
    expect(first).toEqual({ columns, revision: 1 });
    const again = app.call(server);
    expect(await again.multiFormat({ account: '4999' })).toEqual(first);
    await expect(api.saveMultiFormat({ ...input, columns: null, confirmed: true })).rejects.toThrow(
      /其他窗口/,
    );
    expect((await api.multiReport(query({ columns: undefined }))).columns[0]!.code).toBe('499901');
    expect(
      await api.saveMultiFormat({ ...input, columns: null, expectedRevision: 1, confirmed: true }),
    ).toEqual({ columns: null, revision: 2 });
    expect(await api.multiFormat({ account: '1002' })).toEqual({ columns: null, revision: 0 });
  });
  it('无效栏目保存整体回滚，不增加版本；并行同版本只有一次成功', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const input = { account: '4999', columns, expectedRevision: 0, confirmed: true };
    await expect(
      api.saveMultiFormat({ ...input, columns: [{ ...columns[0]!, accountCodes: ['1001'] }] }),
    ).rejects.toThrow(/范围/);
    expect(await api.multiFormat({ account: '4999' })).toEqual({ columns: null, revision: 0 });
    const results = await Promise.allSettled([
      api.saveMultiFormat(input),
      api.saveMultiFormat(input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await api.multiFormat({ account: '4999' })).toEqual({ columns, revision: 1 });
  });
  it('w_zc_dlz_1：自定义248栏可以导出，第249栏被拒绝；XLSX保留每栏名称、方向及整分', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    const many = Array.from({ length: 248 }, (_, i) => ({
      ...columns[0]!,
      name: `合成栏${i + 1}`,
    }));
    const file = await api.multiExport(query({ columns: many }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.columnCount).toBe(256);
    expect(sheet.getRow(2).getCell(9).value).toContain('合成栏1（借方发生额）');
    const month = file.report.rows.findIndex((r) => r.kind === 'month') + 3;
    expect(sheet.getRow(month).getCell(256).value).toBe('7.00');
    expect(sheet.getRow(month).getCell(256).type).toBe(ExcelJS.ValueType.String);
    await expect(
      api.multiExport(query({ columns: [...many, { ...columns[0]!, name: '第249栏' }] })),
    ).rejects.toThrow(/248/);
  });
  it('查看、保存与导出权限仍在服务端分开检查；无权限保存不会产生设置', async () => {
    await seedMultiBook(app.svc);
    const viewer = app.call(
      server,
      await app.addUser('custom-viewer', { permissions: ['ledgers.view'] }),
    );
    await expect(
      viewer.saveMultiFormat({ account: '4999', columns, expectedRevision: 0, confirmed: true }),
    ).rejects.toThrow(/权限/);
    await expect(viewer.multiExport(query())).rejects.toThrow(/权限/);
    expect(await viewer.multiFormat({ account: '4999' })).toEqual({ columns: null, revision: 0 });
    const denied = app.call(server, await app.addUser('no-view'));
    await expect(denied.multiFormat({ account: '4999' })).rejects.toThrow(/权限/);
  });
  it('自定义与辅助URL严格校验，未知维度与非整数ID拒绝', () => {
    const raw = { account: '4999', columns: JSON.stringify(columns), aux: '{"department":1}' };
    expect(parseMultiUrl(raw, 202607).query).toMatchObject({
      columns,
      dimensions: { department: 1 },
    });
    for (const aux of ['{"unknown":1}', '{"department":1.5}', '{"department":"1"}', '[]'])
      expect(parseMultiUrl({ ...raw, aux }, 202607).error).toBeTruthy();
  });
});

describe('w_zc_fhdlz/w_zc_fhdlz_1 辅助多栏明细账', () => {
  it('部门筛选同时约束期初、逐笔、月合计、本年累计和导出，不混入其他部门或未过账', async () => {
    const { codeScheme } = await app.svc.book.info();
    for (const code of ['4999', '499901', '499902'])
      await app.svc.accounts.create(
        {
          code,
          name: `合成部门科目${code}`,
          categoryId: 'equity',
          dimensions: [{ type: 'department' }],
        },
        codeScheme,
      );
    const department = (await app.svc.dimensions.getByCode('department', '01'))!;
    const account = (await app.svc.accounts.require('499901'))!;
    await app.svc.opening.upsert({
      year: 2026,
      accountId: account.id,
      dimensions: { department: department.id },
      balance: 1000,
      ytdDebit: 200,
      ytdCredit: 10,
    });
    await seedVouchers(app.svc, [
      {
        date: '2026-07-01',
        status: 'posted',
        lines: [
          { account: '499901', debit: 101, dims: { department: '01' } },
          { account: '4001', credit: 101 },
        ],
      },
      {
        date: '2026-07-02',
        status: 'posted',
        lines: [
          { account: '499902', credit: -2, dims: { department: '01' } },
          { account: '4001', debit: -2 },
        ],
      },
      {
        date: '2026-07-03',
        status: 'posted',
        lines: [
          { account: '499901', debit: 900, dims: { department: '02' } },
          { account: '4001', credit: 900 },
        ],
      },
      {
        date: '2026-07-04',
        status: 'pending',
        lines: [
          { account: '499901', debit: 300, dims: { department: '01' } },
          { account: '4001', credit: 300 },
        ],
      },
    ]);
    const q = query({ columns: undefined, mode: 'net', dimensions: { department: department.id } });
    const file = await app.call(server).multiExport(q);
    expect(file.report.entryCount).toBe(2);
    expect(file.report.rows[0]!.signedBalance).toBe(1000);
    expect(file.report.rows.at(-1)!.signedBalance).toBe(1103);
    expect(file.report.rows.find((r) => r.kind === 'ytd')).toMatchObject({ debit: 301, credit: 8 });
    expect(file.report.scope).toContain('部门：01');
    const custom = await app.call(server).multiReport({
      ...q,
      columns: columns.map((c) => ({
        ...c,
        accountCodes: c.accountCodes.map((code) => (code === '49990101' ? '499901' : code)),
      })),
    });
    expect(Object.values(custom.rows.find((r) => r.kind === 'month')!.values)).toEqual([
      101, 0, 103,
    ]);
    expect(
      (await app.call(server).multiReport({ ...q, includeUnposted: true })).rows.at(-1)!
        .signedBalance,
    ).toBe(1403);
    await expect(
      app.call(server).multiReport({ ...q, dimensions: { department: 999999 } }),
    ).rejects.toThrow(/不存在/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Uint8Array.from(Buffer.from(file.base64, 'base64')).buffer);
    expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toContain('部门：01');
    expect(wb.worksheets[0]!.getRow(file.report.rows.length + 2).getCell(8).value).toBe('11.03');
  });
});

describe('账簿读取与格式保存的数据保护', () => {
  it('来源凭证查询/导出后仍锁定，既不改源凭证也不解除来源保护', async () => {
    const t = await createTestBook({
      modules: {
        manifest: (id) =>
          id === 'synthetic-source'
            ? ({
                id: 'synthetic-source',
                name: '合成来源',
                sources: [{ type: 'document', name: '合成单据', path: '/document?id={id}' }],
              } as never)
            : undefined,
        permissionName: () => undefined,
      },
    });
    try {
      const source = t.forModule('synthetic-source');
      const input = await voucherInputFromSpec(source, {
        date: '2026-07-01',
        lines: [
          { account: '100201', debit: 101 },
          { account: '4001', credit: 101 },
        ],
      });
      const v = await source.vouchers.create({
        ...input,
        source: { type: 'document', id: 'synthetic-1' },
      });
      const before = await source.vouchers.get(v.id);
      const svc = t.forModule('ledgers');
      const q = query({
        account: '1002',
        includeUnposted: true,
        columns: [{ name: '合成来源借方', accountCodes: ['100201'], mode: 'debit' }],
      });
      expect((await multiService(svc).report(q)).entryCount).toBe(1);
      expect((await exportMulti(svc, q)).report.rows.find((r) => r.kind === 'entry')!.href).toBe(
        `/m/voucher-entry/edit?id=${v.id}`,
      );
      await expect(
        svc.vouchers.update(v.id, input, { expectedRevision: v.revision }),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_FROM_SOURCE' } });
      await expect(svc.vouchers.delete(v.id)).rejects.toMatchObject({
        data: { code: 'VOUCHER_FROM_SOURCE' },
      });
      expect(await source.vouchers.get(v.id)).toEqual(before);
    } finally {
      await t.close();
    }
  });
  it('真实SQLite在线备份保留已存多栏格式及凭证，后续恢复标准格式不会改变备份', async () => {
    await seedMultiBook(app.svc);
    const api = app.call(server);
    await api.saveMultiFormat({ account: '4999', columns, expectedRevision: 0, confirmed: true });
    const live = app.runtime.bookStore.open(app.book.id);
    const backup = path.join(path.dirname(live.file), 'synthetic-multi-format-backup.caiwu');
    await live.raw.backup(backup);
    await api.saveMultiFormat({
      account: '4999',
      columns: null,
      expectedRevision: 1,
      confirmed: true,
    });
    const connection = openDatabase<CoreDB>(backup);
    try {
      const archived = createCoreServices({ ...app.svcFor('ledgers').ctx, db: connection.db });
      expect(await multiFormatService(archived).read('4999')).toEqual({ columns, revision: 1 });
      expect((await multiService(archived).report(query())).rows.at(-1)!.signedBalance).toBe(5800);
      expect(await api.multiFormat({ account: '4999' })).toEqual({ columns: null, revision: 2 });
    } finally {
      await connection.close();
    }
  });
});
