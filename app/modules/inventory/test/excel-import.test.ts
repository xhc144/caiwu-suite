import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { importExportColumns, readInventoryXlsx } from '../excel';
import type { DocumentInput } from '../shared';
let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;
let document: DocumentInput;
async function xlsx(headers: string[], values: (string | number | boolean | null)[]) {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('明细');
  ws.addRow(headers);
  ws.addRow(values);
  return readInventoryXlsx(new Uint8Array(await wb.xlsx.writeBuffer()).buffer, 'document');
}
const headers = ['产品编号', '数量', '单价（元）', '含税口径（是/否）', '说明'];
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  const warehouseId = await api.saveWarehouse({ code: '01', name: '导入仓' });
  await api.saveProduct({ code: 'P1', name: '含税测试产品' });
  document = {
    kind: 'receipt',
    warehouseId,
    requestKey: randomUUID(),
    number: 'XLSX-1',
    date: '2026-01-10',
    category: '采购',
    accountId: (await app.svc.accounts.require('1001')).id,
    taxRate: '13',
    lines: [],
  };
});
afterEach(async () => app.close());
describe('w_ck_rk1/f_rkd_get：真实 XLSX 含税口径不丢失', () => {
  it.each([
    ['含税口径（是/否）', '是', true, 10000, 1300, 11300],
    ['含税口径', '是', true, 10000, 1300, 11300],
    ['含税口径（是/否）', '否', false, 11300, 1469, 12769],
    ['含税口径', '否', false, 11300, 1469, 12769],
  ] as const)(
    '%s=%s：XLSX→预览→入库→金额回读',
    async (header, basis, inclusive, net, tax, gross) => {
      const parsed = await xlsx(
        ['产品编号', '数量', '单价', header, '说明'],
        ['P1', '1', '113', basis, '含税回归'],
      );
      expect(parsed.errors).toEqual([]);
      const payload = { kind: 'document' as const, document, ...parsed };
      const preview = await api.importPreview(payload);
      expect(preview.errors).toEqual([]);
      expect(preview.amounts).toEqual({ netCents: net, taxCents: tax, grossCents: gross });
      expect(await api.documents({})).toEqual([]);
      await api.importSave({ ...payload, confirmation: preview.confirmation });
      const saved = await api.document({ id: (await api.documents({}))[0]!.id });
      expect(saved.lines[0]).toMatchObject({
        priceIncludesTax: inclusive,
        unitPrice: '113',
        net_cents: net,
        tax_cents: tax,
        gross_cents: gross,
        quantity_e6: 1000000,
      });
      expect((await api.stock({ warehouseId: document.warehouseId }))[0]!.receiptCents).toBe(net);
    },
  );
  it.each([null, '', '错误', '停用', '1', '0', 1])(
    '含税口径=%j：XLSX 逐行报错，API 也禁止默认落为不含税',
    async (value) => {
      const parsed = await xlsx(headers, ['P1', '1', '113', value, '']);
      expect(parsed.errors).toEqual([
        { row: 2, message: expect.stringContaining('不能留空或使用其他值') },
      ]);
      const payload = {
        kind: 'document' as const,
        document,
        rows: parsed.rows,
        rowNumbers: parsed.rowNumbers,
      };
      const p = await api.importPreview(payload);
      expect(p.errors).toEqual([{ row: 2, message: expect.stringContaining('含税口径') }]);
      expect(p.amounts).toBeNull();
      await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow(
        /逐行错误/,
      );
      expect(await api.documents({})).toEqual([]);
    },
  );
  it('未知列、旧错误别名“含税单价”、缺口径列、重复别名在读取时明确拒绝', async () => {
    for (const header of ['含税单价', '含税口径拼错']) {
      const p = await xlsx(['产品编号', '数量', '单价', header], ['P1', '1', '113', '是']);
      expect(p.errors).toEqual(
        expect.arrayContaining([
          { row: 1, message: expect.stringContaining('无法识别') },
          { row: 1, message: expect.stringContaining('缺少必填列') },
        ]),
      );
    }
    const missing = await xlsx(['产品编号', '数量', '单价'], ['P1', '1', '113']);
    expect(missing.errors[0]?.message).toContain('含税口径');
    const dup = await xlsx([...headers, '含税口径'], ['P1', '1', '113', '是', '', '否']);
    expect(dup.errors).toEqual([{ row: 1, message: expect.stringContaining('重复映射') }]);
  });
  it('直接 API 带未知业务列不能由 Zod strip；缺省、空和错类型口径不能绕过读取器', async () => {
    for (const row of [
      {
        productCode: 'P1',
        quantity: '1',
        unitPrice: '113',
        priceIncludesTax: true,
        含税口径: '是',
      },
      {
        productCode: 'P1',
        quantity: '1',
        unitPrice: '113',
        priceIncludesTax: true,
        priceIncluesTax: '是',
      },
      { productCode: 'P1', quantity: '1', unitPrice: '113' },
      { productCode: 'P1', quantity: '1', unitPrice: '113', priceIncludesTax: '' },
      { productCode: 'P1', quantity: '1', unitPrice: '113', priceIncludesTax: '是' },
    ]) {
      const payload = { kind: 'document' as const, document, rows: [row] };
      const p = await api.importPreview(payload);
      expect(p.errors).toHaveLength(1);
      expect(p.amounts).toBeNull();
      await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow(
        /逐行错误/,
      );
    }
    expect(await api.documents({})).toEqual([]);
    expect(
      (
        await api.importPreview({
          kind: 'products',
          rows: [{ code: 'P2', name: '产品', 未知业务列: '是' }],
        })
      ).errors[0]?.message,
    ).toContain('无法识别导入列');
    expect(
      (
        await api.importPreview({
          kind: 'opening',
          warehouseId: document.warehouseId,
          revision: 0,
          rows: [{ productCode: 'P1', quantity: '1', unitPrice: '113', 税口径: '是' }],
        })
      ).errors[0]?.message,
    ).toContain('无法识别导入列');
  });
  it('正式导出与模板同列，按所选含税单价113回导为净100税13合计113', async () => {
    const row = {
      productCode: 'P1',
      quantity: '1',
      unitPrice: '113',
      priceIncludesTax: true,
      note: '可回导',
    };
    const columns = importExportColumns('document');
    expect(columns.map((c) => c.title)).toEqual(headers);
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet('导出');
    ws.addRow(columns.map((c) => c.title));
    ws.addRow(columns.map((c) => c.value(row)));
    const parsed = await readInventoryXlsx(
      new Uint8Array(await wb.xlsx.writeBuffer()).buffer,
      'document',
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([row]);
    const payload = {
      kind: 'document' as const,
      document,
      rows: parsed.rows,
      rowNumbers: parsed.rowNumbers,
    };
    const p = await api.importPreview(payload);
    await api.importSave({ ...payload, confirmation: p.confirmation });
    const saved = await api.document({ id: (await api.documents({}))[0]!.id });
    expect(saved.lines[0]).toMatchObject({ net_cents: 10000, tax_cents: 1300, gross_cents: 11300 });
  });
});
