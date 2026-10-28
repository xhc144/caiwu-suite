import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { importExportColumns, readInventoryXlsx } from '../excel';

let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;
const row = (number = 'HT1') => ({
  number,
  warehouseCode: '01',
  supplierCode: 'S001',
  date: '2026-01-05',
  dueDate: '2026-01-20',
  agent: '合成采购员',
  note: '合同头说明',
  status: 'open',
  productCode: 'P1',
  quantity: '2.5',
  unitPrice: '3.12',
  lineNote: '明细说明',
});
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  await api.saveWarehouse({ code: '01', name: '合同文件仓' });
  await api.saveProduct({ code: 'P1', name: '合成合同产品' });
});
afterEach(async () => app.close());
it('ht1/ht2：多行同产品计划数量溢出在预览逐行指出，整批不保存', async () => {
  const payload = {
    kind: 'contracts' as const,
    rows: Array.from({ length: 10 }, () => ({ ...row(), quantity: '999999999', unitPrice: '0' })),
  };
  const preview = await api.importPreview(payload);
  expect(preview.errors.some((e) => /数量.*范围/.test(e.message))).toBe(true);
  await expect(api.importSave({ ...payload, confirmation: preview.confirmation })).rejects.toThrow(
    /未保存任何合同/,
  );
  expect(await api.contracts({})).toEqual([]);
});
it('ht1/ht2/w_cb_ck_copy：真实Excel完整头行往返，按编码映射，分组保存多合同且库存不变', async () => {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('合同');
  const columns = importExportColumns('contracts');
  ws.addRow(columns.map((c) => c.title));
  for (const r of [
    row(),
    { ...row(), quantity: '1.25', unitPrice: '4.56', lineNote: '第二行' },
    row('HT2'),
  ])
    ws.addRow(columns.map((c) => c.value(r)));
  const parsed = await readInventoryXlsx(
    new Uint8Array(await wb.xlsx.writeBuffer()).buffer,
    'contracts',
  );
  expect(parsed.errors).toEqual([]);
  const payload = { kind: 'contracts' as const, rows: parsed.rows, rowNumbers: parsed.rowNumbers };
  const preview = await api.importPreview(payload);
  expect(preview.errors).toEqual([]);
  expect(preview.amounts?.netCents).toBe(2130);
  expect(await api.contracts({})).toEqual([]);
  await api.importSave({ ...payload, confirmation: preview.confirmation });
  const saved = await api.contracts({});
  expect(saved).toHaveLength(2);
  const exported = await api.exportContracts({ ids: [...saved].reverse().map((c) => c.id) });
  expect(exported).toEqual([
    row(),
    { ...row(), quantity: '1.25', unitPrice: '4.56', lineNote: '第二行' },
    row('HT2'),
  ]);
  expect((await api.stock({}))[0]?.balance).toBe('0');
  const target = await createTestApp({ modules: [server], product: 'chengben' });
  try {
    const to = target.call(server);
    await to.saveWarehouse({ code: 'OTHER', name: '错开ID' });
    await to.saveWarehouse({ code: '01', name: '目标仓' });
    await to.saveProduct({ code: 'OTHER', name: '错开ID' });
    await to.saveProduct({ code: 'P1', name: '目标产品' });
    const p = await to.importPreview({ kind: 'contracts', rows: exported });
    expect(p.errors).toEqual([]);
    await to.importSave({ kind: 'contracts', rows: exported, confirmation: p.confirmation });
    const c = await to.contract({ id: (await to.contracts({ keyword: 'HT1' }))[0]!.id });
    expect(c.warehouse_id).toBe(2);
    expect(c.lines.map((l) => l.quantity)).toEqual(['2.5', '1.25']);
  } finally {
    await target.close();
  }
});
it('ht1/ht2：头信息不一致、未知档案、坏日期、错误类型及已有合同均逐行报错，不覆盖', async () => {
  const payload = {
    kind: 'contracts' as const,
    rows: [
      row(),
      { ...row(), supplierCode: 'C001' },
      { ...row('HT2'), productCode: 'UNKNOWN' },
      { ...row('HT3'), dueDate: '2025-12-31' },
      { ...row('HT4'), quantity: 'nan' },
    ],
  };
  const p = await api.importPreview(payload);
  expect(p.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
  await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow(
    /未保存任何合同/,
  );
  expect(await api.contracts({})).toEqual([]);
  const valid = { kind: 'contracts' as const, rows: [row()] },
    preview = await api.importPreview(valid);
  await api.importSave({ ...valid, confirmation: preview.confirmation });
  const duplicate = await api.importPreview(valid);
  expect(duplicate.errors[0]?.message).toMatch(/不能覆盖/);
  const overwrite = await api.importPreview({ ...valid, overwrite: true });
  expect(overwrite.errors.some((e) => /只新增/.test(e.message))).toBe(true);
});
it('ht1/ht2：档案变化使预览失效，第二合同写入故障时整批和日志回滚，同原预览可重试', async () => {
  const payload = { kind: 'contracts' as const, rows: [row('HT1'), row('FAIL')] };
  let preview = await api.importPreview(payload);
  await api.saveProduct({ code: 'P2', name: '预览后变化' });
  await expect(api.importSave({ ...payload, confirmation: preview.confirmation })).rejects.toThrow(
    /预览已过期/,
  );
  preview = await api.importPreview(payload);
  await sql
    .raw(
      "CREATE TEMP TRIGGER inventory_contract_test_fail BEFORE INSERT ON inventory_contract WHEN NEW.number='FAIL' BEGIN SELECT RAISE(ABORT,'合同磁盘故障'); END",
    )
    .execute(app.svc.db);
  await expect(api.importSave({ ...payload, confirmation: preview.confirmation })).rejects.toThrow(
    /合同磁盘故障/,
  );
  expect(await api.contracts({})).toEqual([]);
  expect((await app.svc.log.list()).some((l) => l.action === 'inventory.contract.save')).toBe(
    false,
  );
  await sql.raw('DROP TRIGGER inventory_contract_test_fail').execute(app.svc.db);
  await api.importSave({ ...payload, confirmation: preview.confirmation });
  expect(await api.contracts({})).toHaveLength(2);
});
it('ht1/ht2：Excel公式和未知列拒绝，合同含税口径不会被静默改为不含税', async () => {
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet('合同');
  const cols = importExportColumns('contracts');
  ws.addRow([...cols.map((c) => c.title), '未知列']);
  const data = ws.addRow([...cols.map((c) => c.value(row())), 'x']);
  data.getCell(10).value = { formula: '1+1', result: 2 };
  const parsed = await readInventoryXlsx(
    new Uint8Array(await wb.xlsx.writeBuffer()).buffer,
    'contracts',
  );
  expect(parsed.errors.some((e) => /公式/.test(e.message))).toBe(true);
  expect(parsed.errors.some((e) => /无法识别/.test(e.message))).toBe(true);
  await expect(
    api.saveContract({
      number: 'HT1',
      warehouseId: 1,
      supplierId: (await app.svc.dimensions.getByCode('partner', 'S001'))!.id,
      date: '2026-01-05',
      lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2', priceIncludesTax: true }],
    }),
  ).rejects.toThrow(/不含税/);
});
