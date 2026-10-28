import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { BulkDeleteCommitSchema, type ImportInput } from '../bulk-shared';
import type { DocumentInput } from '../shared';
import cashierServer from '../server';
import { bulkService } from '../server/bulk';
import { cashierService } from '../server/service';
import type { CashierTables } from '../server/migrations';
import { normalizeImportGrid, parseDelimited, readImportFile } from '../web/import-file';

let app: TestApp;
let bank: number;
let opposite: number;
let cf: number;
const svc = () => app.svcFor('cashier');
const bulk = () => bulkService(svc());
const cashier = () => cashierService(svc());
beforeEach(async () => {
  app = await createTestApp({ modules: [cashierServer] });
  await cashier().enable(202601);
  opposite = (await app.svc.accounts.require('6603')).id;
  cf = (await app.svc.dimensions.getByCode('cashflow', 'CF01'))!.id;
  bank = (
    await cashier().saveAccount({
      name: '导入测试银行',
      coreAccountId: (await app.svc.accounts.require('100201')).id,
      currency: 'CNY',
      opening: 0,
    })
  ).id;
});
afterEach(async () => {
  await app.close();
});
const data = (change: Partial<DocumentInput> = {}): DocumentInput => ({
  accountId: bank,
  period: 202601,
  date: '2026-01-10',
  summary: '合成收款',
  direction: 'receipt',
  amount: 100,
  dimensions: { cashflow: cf },
  oppositeAccountId: opposite,
  ...change,
});
const create = (change: Partial<DocumentInput> = {}) =>
  cashier().createDocument({ ...data(change), requestKey: randomUUID() });
const deleteCommit = (previewToken: string) => ({
  previewToken,
  rangeConfirmed: '已核对范围' as const,
  deleteConfirmed: '删除' as const,
});
const importInput = (changes: Partial<ImportInput> = {}): ImportInput => ({
  requestKey: randomUUID(),
  fileName: '合成.csv',
  rows: [
    ['2026-01-10', '第一行', '12.34', '', '6603'],
    ['2026-01-11', '第二行', '', '2.01', '6603'],
  ],
  mapping: { date: 0, summary: 1, receipt: 2, payment: 3, oppositeAccount: 4 },
  defaultAccountId: bank,
  defaultDimensions: { cashflow: cf },
  ...changes,
});
const importCommit = (input: ImportInput, previewToken: string) => ({
  ...input,
  previewToken,
  confirmed: true as const,
});

describe('w_cn_lr_del 批量删除', () => {
  it('日期范围预览只删除已预览目标，不包含预览后新增单', async () => {
    const d = await create();
    const outside = await create({ date: '2026-01-20' });
    const p = await bulk().previewDelete({ filter: { from: '2026-01-01', to: '2026-01-15' } });
    expect(p.rows.map((r) => r.id)).toEqual([d.id]);
    const newer = await create();
    expect(await bulk().deleteDocuments(deleteCommit(p.previewToken))).toEqual({
      deleted: [d.id],
      skipped: [],
    });
    expect((await cashier().documents()).map((r) => r.id)).toEqual([newer.id, outside.id]);
  });
  it('已生成凭证、已勾账、已结月份逐项跳过并报告，不删除凭证', async () => {
    const a = await create();
    const b = await create({ amount: 200 });
    const c = await create({ date: '2026-02-02', period: 202602 });
    const d = await create({ date: '2026-03-01', period: 202603 });
    await cashier().generate({
      documents: [{ id: a.id, revision: 1 }],
      mode: 'individual',
      date: '2026-01-10',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      requestKey: randomUUID(),
    });
    const db = svc().db.withTables<CashierTables>();
    const match = await db
      .insertInto('cashier_match')
      .values({ account_id: bank, amount: 200, created_at: new Date().toISOString() })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('cashier_match_document')
      .values({ document_id: b.id, match_id: match.id })
      .execute();
    await db.insertInto('cashier_period').values({ period: 202602, closed: 1 }).execute();
    const p = await bulk().previewDelete({
      selection: (await cashier().documents()).map((r) => ({ id: r.id, revision: r.revision })),
    });
    expect(p).toMatchObject({ eligible: 1, skipped: 3 });
    expect(p.rows.find((r) => r.id === a.id)?.reason).toContain('已生成凭证');
    expect(p.rows.find((r) => r.id === b.id)?.reason).toContain('已勾账');
    expect(p.rows.find((r) => r.id === c.id)?.reason).toContain('已经结账');
    const result = await bulk().deleteDocuments(deleteCommit(p.previewToken));
    expect(result.deleted).toEqual([d.id]);
    expect(result.skipped).toHaveLength(3);
    expect((await app.svc.vouchers.list({})).total).toBe(1);
  });
  it('预览后版本变化、总账关闭、单据删除分别跳过', async () => {
    const a = await create();
    const b = await create({ date: '2026-02-01', period: 202602 });
    const c = await create();
    const p = await bulk().previewDelete({
      selection: [a, b, c].map((r) => ({ id: r.id, revision: 1 })),
    });
    await cashier().updateDocument(a.id, 1, data({ summary: '更改后保留' }));
    await app.svc.periods.setStatus(202602, 'closed');
    await cashier().removeDocument(c.id, 1);
    const result = await bulk().deleteDocuments(deleteCommit(p.previewToken));
    expect(result.deleted).toEqual([]);
    expect(result.skipped.map((r) => r.reason).join('；')).toMatch(/修改.*已经结账.*已删除/);
    expect((await cashier().documents()).map((r) => r.id)).toEqual([a.id, b.id]);
  });
  it('两个确认不可省略，篡改、跨操作员、跨账套令牌拒绝', async () => {
    const a = await create();
    const p = await bulk().previewDelete({ selection: [{ id: a.id, revision: 1 }] });
    expect(
      BulkDeleteCommitSchema.safeParse({
        previewToken: p.previewToken,
        rangeConfirmed: '已核对范围',
      }).success,
    ).toBe(false);
    await expect(
      bulk().deleteDocuments(deleteCommit(`${p.previewToken.slice(0, -4)}xxxx`)),
    ).rejects.toThrow('预览');
    const token = await app.addUser('delete-clerk', { permissions: ['cashier.document.edit'] });
    await expect(
      app.call(cashierServer, token).deleteDocuments(deleteCommit(p.previewToken)),
    ).rejects.toThrow('操作员');
    const other = await createTestApp({ modules: [cashierServer] });
    try {
      await expect(
        bulkService(other.svcFor('cashier')).deleteDocuments(deleteCommit(p.previewToken)),
      ).rejects.toThrow('账套');
    } finally {
      await other.close();
    }
    expect(await cashier().documents()).toHaveLength(1);
  });
  it('后续删除失败整体回滚，可以原计划重试', async () => {
    await create();
    await create({ amount: 200 });
    const p = await bulk().previewDelete({ filter: { from: '2026-01-01', to: '2026-01-31' } });
    await sql`CREATE TRIGGER cashier_bulk_failure BEFORE UPDATE OF deleted ON cashier_document WHEN OLD.amount = 200 BEGIN SELECT RAISE(ABORT, '合成删除故障'); END`.execute(
      app.svc.db,
    );
    await expect(bulk().deleteDocuments(deleteCommit(p.previewToken))).rejects.toThrow(
      '合成删除故障',
    );
    expect(await cashier().documents()).toHaveLength(2);
    await sql`DROP TRIGGER cashier_bulk_failure`.execute(app.svc.db);
    expect((await bulk().deleteDocuments(deleteCommit(p.previewToken))).deleted).toHaveLength(2);
  });
  it('缺日期、非法日期范围、空范围和无权限明确阻止', async () => {
    await expect(bulk().previewDelete({ filter: {} })).rejects.toThrow();
    await expect(
      bulk().previewDelete({ filter: { from: '2026-02-01', to: '2026-01-01' } }),
    ).rejects.toThrow();
    await expect(
      bulk().previewDelete({ filter: { from: '2026-01-01', to: '2026-01-31' } }),
    ).rejects.toThrow('没有出纳单据');
    const token = await app.addUser('bulk-viewer', { permissions: ['cashier.view'] });
    await expect(
      app.call(cashierServer, token).previewDelete({ selection: [{ id: 1, revision: 1 }] }),
    ).rejects.toThrow('权限');
  });
});

describe('w_bb_def_cn0_bak / w_bb_saveas 文件导入', () => {
  it('映射预览不写库；整数金额、空行跳过；确认原子写入及幂等重试', async () => {
    const input = importInput();
    input.rows.push(['', '', '', '', '']);
    const p = await bulk().previewImport(input);
    expect(p).toMatchObject({ valid: 2, errors: 0, empty: 1 });
    expect(p.rows.map((r) => r.amount)).toEqual([1234, 201, null]);
    expect(await cashier().documents()).toEqual([]);
    const done = await bulk().importDocuments(importCommit(input, p.previewToken!));
    expect(done.count).toBe(2);
    expect(await bulk().importDocuments(importCommit(input, p.previewToken!))).toEqual(done);
    expect((await cashier().documents()).map((r) => [r.summary, r.amount, r.direction])).toEqual([
      ['第一行', 1234, 'receipt'],
      ['第二行', 201, 'payment'],
    ]);
    await expect(
      bulk().importDocuments(importCommit({ ...input, fileName: '变动.csv' }, p.previewToken!)),
    ).rejects.toThrow('内容已改变');
  });
  it('启用前、已结月、非法日期与收付冲突逐行给错且不允许提交', async () => {
    const input = importInput({
      rows: [
        ['2025-12-31', '启用前', '1', '', '6603'],
        ['2026-02-01', '关闭月', '1', '', '6603'],
        ['2026-02-30', '非法日期', '1', '', '6603'],
        ['2026-01-01', '收付都有', '1', '2', '6603'],
        ['2026-01-02', '收付都无', '', '', '6603'],
      ],
    });
    await app.svc.periods.setStatus(202602, 'closed');
    const p = await bulk().previewImport(input);
    expect(p).toMatchObject({ valid: 0, errors: 5, previewToken: null });
    expect(p.rows[0]?.error).toContain('启用');
    expect(p.rows[1]?.error).toContain('已经结账');
    expect(p.rows[2]?.error).toContain('日期');
    expect(await cashier().documents()).toEqual([]);
  });
  it('无账户、缺必要辅助、非法科目、不安全金额在预览阻止', async () => {
    expect((await bulk().previewImport(importInput({ defaultAccountId: 999 }))).errors).toBe(2);
    expect(
      (await bulk().previewImport(importInput({ defaultDimensions: {} }))).rows[0]?.error,
    ).toContain('现金流量');
    const p = await bulk().previewImport(
      importInput({
        rows: [
          ['2026-01-01', '非法科目', '1', '', '9999'],
          ['2026-01-01', '大金额', '9007199254740999', '', '6603'],
        ],
      }),
    );
    expect(p.errors).toBe(2);
    expect(p.rows[0]?.error).toContain('不存在');
  });
  it('支持账户与辅助编码映射及金额方向格式，重复映射列拒绝', async () => {
    const input = importInput({
      defaultAccountId: undefined,
      rows: [['100201', 'CNY', '2026/01/10', '编码格式', '12.34', '付款', 'CF01', '6603']],
      mapping: {
        account: 0,
        currency: 1,
        date: 2,
        summary: 3,
        amount: 4,
        direction: 5,
        cashflow: 6,
        oppositeAccount: 7,
      },
      defaultDimensions: {},
    });
    const p = await bulk().previewImport(input);
    expect(p).toMatchObject({ valid: 1, errors: 0 });
    await bulk().importDocuments(importCommit(input, p.previewToken!));
    expect((await cashier().documents())[0]).toMatchObject({
      amount: 1234,
      direction: 'payment',
      dimensions: { cashflow: cf },
    });
    await expect(
      bulk().previewImport(importInput({ mapping: { date: 0, summary: 0 } })),
    ).rejects.toThrow('同一文件列');
  });
  it('预览后文件变动拒绝；账户停用或期间关闭复检失败不写入', async () => {
    const input = importInput();
    const p = await bulk().previewImport(input);
    await expect(
      bulk().importDocuments(
        importCommit(
          { ...input, rows: [['2026-01-01', '被替换', '99', '', '6603']] },
          p.previewToken!,
        ),
      ),
    ).rejects.toThrow('已经改变');
    await cashier().setDisabled(bank, 1, true);
    await expect(bulk().importDocuments(importCommit(input, p.previewToken!))).rejects.toThrow(
      '未保存任何单据',
    );
    expect(await cashier().documents()).toEqual([]);
  });
  it('保存第二行失败回滚首行和导入收据，原请求能安全重试', async () => {
    const input = importInput();
    const p = await bulk().previewImport(input);
    await sql`CREATE TRIGGER cashier_import_failure BEFORE INSERT ON cashier_document WHEN NEW.summary = '第二行' BEGIN SELECT RAISE(ABORT, '合成导入故障'); END`.execute(
      app.svc.db,
    );
    await expect(bulk().importDocuments(importCommit(input, p.previewToken!))).rejects.toThrow(
      '合成导入故障',
    );
    expect(await cashier().documents()).toEqual([]);
    expect(await svc().settings.get(`import:${input.requestKey}`, null)).toBeNull();
    await sql`DROP TRIGGER cashier_import_failure`.execute(app.svc.db);
    expect((await bulk().importDocuments(importCommit(input, p.previewToken!))).count).toBe(2);
  });
  it('原币金额及汇率映射和本位币折算校验完整，外币收付可导入生成凭证', async () => {
    const foreignId = (
      await cashier().saveAccount({
        name: '美元银行',
        coreAccountId: (await app.svc.accounts.require('100202')).id,
        currency: 'USD',
        opening: 0,
        foreignOpening: 0,
      })
    ).id;
    const input = importInput({
      defaultAccountId: foreignId,
      rows: [['2026-01-10', '美元导入', '71.00', '10.00', '7.1', '6603']],
      mapping: {
        date: 0,
        summary: 1,
        receipt: 2,
        foreignAmount: 3,
        exchangeRate: 4,
        oppositeAccount: 5,
      },
    });
    const p = await bulk().previewImport(input);
    expect(p).toMatchObject({ valid: 1, errors: 0 });
    await bulk().importDocuments(importCommit(input, p.previewToken!));
    const saved = (await cashier().documents())[0]!;
    expect(saved).toMatchObject({
      accountId: foreignId,
      amount: 7100,
      foreignAmount: 1000,
      exchangeRate: '7.1',
    });
    await cashier().generate({
      documents: [{ id: saved.id, revision: saved.revision }],
      date: '2026-01-10',
      mode: 'individual',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      requestKey: randomUUID(),
    });
    const voucher = await app.svc.vouchers.get((await cashier().documents())[0]!.voucherId!);
    expect(voucher?.lines[0]).toMatchObject({
      currency: 'USD',
      fcAmount: 1000,
      exchangeRate: '7.1',
      debit: 7100,
    });
    const wrong = await bulk().previewImport({
      ...input,
      requestKey: randomUUID(),
      rows: [['2026-01-10', '折算错误', '71.01', '10.00', '7.1', '6603']],
    });
    expect(wrong).toMatchObject({ valid: 0, errors: 1, previewToken: null });
    expect(wrong.rows[0]?.error).toContain('折算');
  });
  it('空数据不签发令牌，缺映射与无权限不能绕过', async () => {
    expect(await bulk().previewImport(importInput({ rows: [['', '', '', '', '']] }))).toMatchObject(
      { valid: 0, errors: 0, empty: 1, previewToken: null },
    );
    await expect(bulk().previewImport(importInput({ mapping: {} }))).rejects.toThrow(
      '日期列和摘要列',
    );
    const viewer = await app.addUser('import-viewer', { permissions: ['cashier.view'] });
    await expect(app.call(cashierServer, viewer).previewImport(importInput())).rejects.toThrow(
      '权限',
    );
  });
});

describe('w_bb_def_cn0_bak 文本格式读取', () => {
  it('CSV 引号内逗号、换行、双引号、BOM与空行不会错列', () => {
    expect(
      parseDelimited('\uFEFF日期,摘要,收款\r\n2026-01-01,"甲,乙\n丙""丁",1.23\r\n,,\r\n'),
    ).toEqual([
      ['日期', '摘要', '收款'],
      ['2026-01-01', '甲,乙\n丙"丁', '1.23'],
      ['', '', ''],
    ]);
    expect(parseDelimited('日期\t摘要\n2026-01-01\t银行')).toEqual([
      ['日期', '摘要'],
      ['2026-01-01', '银行'],
    ]);
  });
  it('真实 Excel 工作簿读取日期、金额与缓存值；不执行单元格公式', async () => {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    const sheet = wb.addWorksheet('收付单');
    sheet.addRow(['日期', '摘要', '收款金额']);
    sheet.addRow([new Date('2026-01-10T00:00:00.000Z'), '合成Excel', 12.34]);
    sheet.getCell('A2').numFmt = 'yyyy-mm-dd';
    sheet.addRow(['2026-01-11', '缓存公式', { formula: '1+2', result: 3 }]);
    const bytes = await wb.xlsx.writeBuffer();
    const file = new File([new Uint8Array(bytes).buffer], '合成.xlsx');
    expect(await readImportFile(file)).toEqual({
      headers: ['日期', '摘要', '收款金额'],
      rows: [
        ['2026-01-10', '合成Excel', '12.34'],
        ['2026-01-11', '缓存公式', '3'],
      ],
    });
    await expect(readImportFile(new File(['损坏'], '坏.xlsx'))).rejects.toThrow('工作簿无法读取');
    await expect(readImportFile(new File(['旧格式'], '旧.xls'))).rejects.toThrow('另存为');
  });
  it('无数据、列数行数过多、引号格式错误明确拒绝', () => {
    expect(() =>
      normalizeImportGrid([
        ['日期', '摘要'],
        ['', ''],
      ]),
    ).toThrow('没有可导入');
    expect(() => normalizeImportGrid([Array(61).fill('列'), ['值']])).toThrow('六十列');
    expect(() =>
      normalizeImportGrid([['列'], ...Array.from({ length: 1001 }, () => ['值'])]),
    ).toThrow('一千行');
    expect(() => parseDelimited('日期,"未结束')).toThrow('未闭合');
    expect(() => parseDelimited('日期,"结束"错')).toThrow('多余文字');
  });
});
