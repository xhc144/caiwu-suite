import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Decimal, multiplyToCents } from '@caiwu/core';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { importExportColumns, readInventoryXlsx } from '../excel';
import { openingCents, openingValue } from '../opening';
import { OpeningRowSchema, type OpeningRowInput } from '../shared';
import type { InventoryTables } from '../server/migrations';

let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let api: ReturnType<typeof caller>;
let warehouseId: number;
const amountRow = (amountCents = 100, quantity = '3'): OpeningRowInput => ({
  productCode: 'P1',
  quantity,
  valueBasis: 'amount',
  amountCents,
});
const priceRow = (quantity = '2.5', unitPrice = '3.33'): OpeningRowInput => ({
  productCode: 'P2',
  quantity,
  unitPrice,
});
const opening = () => api.opening({ warehouseId });
const save = async (rows: OpeningRowInput[], revision?: number) =>
  api.saveOpening({
    warehouseId,
    revision: revision ?? (await opening()).revision,
    confirmReplace: true,
    rows,
  });
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '独立期初仓' });
  await api.saveProduct({ code: 'P1', name: '金额产品' });
  await api.saveProduct({ code: 'P2', name: '单价产品' });
});
afterEach(async () => app.close());

describe('w_cb_qc：明确口径，保留整数分与十进制数量', () => {
  it('同批直接金额1元/数量3反算0.333333；数量2.5×单价3.33为833分；回读及编辑保持口径', async () => {
    await save([amountRow(), priceRow()]);
    const saved = await opening();
    expect(saved.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: 'P1',
          quantity: '3',
          unitPrice: '0.333333',
          amountCents: 100,
          valueBasis: 'amount',
        }),
        expect.objectContaining({
          productCode: 'P2',
          quantity: '2.5',
          unitPrice: '3.33',
          amountCents: 833,
          valueBasis: 'unitPrice',
        }),
      ]),
    );
    const db = app.svc.db.withTables<InventoryTables>();
    expect(
      (
        await db
          .selectFrom('inventory_opening')
          .select('quantity_e6')
          .orderBy('quantity_e6')
          .execute()
      ).map((r) => r.quantity_e6),
    ).toEqual([2500000, 3000000]);
    await save([amountRow(100, '6'), priceRow()]);
    expect((await opening()).rows.find((r) => r.productCode === 'P1')).toMatchObject({
      quantity: '6',
      unitPrice: '0.166667',
      amountCents: 100,
      valueBasis: 'amount',
    });
    // An explicit switch to price basis has its own input; amount is never reused implicitly.
    await save([{ productCode: 'P1', quantity: '6', unitPrice: '2', valueBasis: 'unitPrice' }]);
    expect((await opening()).rows[0]).toMatchObject({
      unitPrice: '2',
      amountCents: 1200,
      valueBasis: 'unitPrice',
    });
  });
  it('直接金额的数量、金额进入库存、台账与盘点快照，数量金额守恒', async () => {
    await save([amountRow(101)]);
    await api.saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'R1',
      date: '2026-01-10',
      category: '采购',
      accountId: (await app.svc.accounts.require('1001')).id,
      lines: [{ productCode: 'P1', quantity: '2.5', unitPrice: '2.55' }],
    });
    const stock = (await api.stock({ warehouseId, productCode: 'P1' }))[0]!;
    expect(stock).toMatchObject({
      opening: '3',
      received: '2.5',
      balance: '5.5',
      openingCents: 101,
      receiptCents: 638,
      balanceCents: 739,
    });
    const ledger = await api.ledger({ warehouseId, productCode: 'P1' });
    expect(ledger.map((r) => r.balance)).toEqual(['3', '5.5']);
    expect(ledger.map((r) => r.balanceCents)).toEqual([101, 739]);
    const count = await api.generateCount({
      warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    expect(count.rows[0]).toMatchObject({ book: '5.5', bookCents: 739 });
  });
  it('旧三字段调用默认数量×单价；零数量零金额保留旧路径，直接金额正数量可为零', async () => {
    await save([priceRow('0', '9.999999'), amountRow(0, '0.000001')]);
    expect((await opening()).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productCode: 'P2',
          quantity: '0',
          unitPrice: '9.999999',
          amountCents: 0,
          valueBasis: 'unitPrice',
        }),
        expect.objectContaining({
          productCode: 'P1',
          quantity: '0.000001',
          unitPrice: '0',
          amountCents: 0,
          valueBasis: 'amount',
        }),
      ]),
    );
  });
  it.each([amountRow(0, '0'), amountRow(1, '0'), amountRow(1, '20000')])(
    '缺证边界%j明确拒绝，原数据、版本和日志完整回滚',
    async (row) => {
      await save([priceRow()]);
      const old = await opening(),
        context = await api.context(),
        logs = await app.svc.log.list();
      await expect(save([amountRow(), { ...row, productCode: 'P2' }])).rejects.toThrow(
        /无法反算|无法回算/,
      );
      expect(await opening()).toEqual(old);
      expect((await api.context()).control).toEqual(context.control);
      expect(await app.svc.log.list()).toEqual(logs);
    },
  );
  it('负数量、负单价、负金额、非整数分、非法数量与双输入不被默认或丢弃', async () => {
    for (const row of [
      amountRow(-1),
      amountRow(0.1),
      amountRow(Number.MAX_SAFE_INTEGER + 1),
      amountRow(1, '-1'),
      amountRow(1, '0.0000001'),
      amountRow(1, ''),
      priceRow('1', '-1'),
      { ...amountRow(), unitPrice: '5' },
      { ...priceRow(), amountCents: 0 },
      { productCode: 'P1', quantity: '1', amountCents: 1 },
    ]) {
      expect(OpeningRowSchema.safeParse(row).success).toBe(false);
      await expect(save([row])).rejects.toThrow();
    }
    for (const yuan of ['-0.01', '0.001', '', 'NaN', '1e3', '90071992547409.92'])
      expect(() => openingCents(yuan)).toThrow();
    expect((await opening()).revision).toBe(0);
    expect((await opening()).rows).toEqual([]);
  });
  it('直接金额中断点、半分单价、最大安全分与最小数量不丢精度', () => {
    expect(openingValue(priceRow('1', '0.005')).amountCents).toBe(1);
    expect(openingValue(amountRow(1, '0.000001'))).toMatchObject({
      unitPrice: '10000',
      amountCents: 1,
    });
    expect(openingValue(amountRow(Number.MAX_SAFE_INTEGER, '1'))).toMatchObject({
      unitPrice: '90071992547409.91',
      amountCents: Number.MAX_SAFE_INTEGER,
    });
    expect(openingCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => openingValue(priceRow('999999999', '999999999'))).toThrow(/超出整数分安全范围/);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999999 }),
        fc.integer({ min: 0, max: 100000000 }),
        (q, cents) => {
          const quantity = new Decimal(q).div(100).toFixed();
          const value = openingValue(amountRow(cents, quantity));
          expect(value.amountCents).toBe(cents);
          expect(multiplyToCents(quantity, value.unitPrice)).toBe(cents);
        },
      ),
      { numRuns: 300 },
    );
  });
  it('重复/未知产品与使用后减少期初仍整批回滚', async () => {
    await save([amountRow(300, '3')]);
    const old = await opening();
    for (const rows of [
      [amountRow(), amountRow()],
      [amountRow(), { ...priceRow(), productCode: 'UNKNOWN' }],
    ])
      await expect(save(rows)).rejects.toThrow(/重复|不存在/);
    await api.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId,
      number: 'S1',
      date: '2026-01-10',
      category: '领用',
      costAccountId: (await app.svc.accounts.require('6401')).id,
      lines: [{ productCode: 'P1', quantity: '2', unitPrice: '1' }],
    });
    await expect(save([amountRow(1, '1')])).rejects.toThrow(/负库存/);
    expect(await opening()).toEqual(old);
  });
  it('并发旧修订只允许一笔，修改后的旧预览拒绝且不覆盖', async () => {
    const payload = { kind: 'opening' as const, warehouseId, revision: 0, rows: [amountRow()] };
    const preview = await api.importPreview(payload);
    expect(preview.errors).toEqual([]);
    const results = await Promise.allSettled([
      save([amountRow(101)], 0),
      save([amountRow(102)], 0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const old = await opening();
    await expect(
      api.importSave({ ...payload, confirmation: preview.confirmation }),
    ).rejects.toThrow(/变化|版本/);
    expect(await opening()).toEqual(old);
    const current = { ...payload, revision: old.revision, overwrite: true };
    const p = await api.importPreview(current);
    await expect(
      api.importSave({ ...current, rows: [amountRow(999)], confirmation: p.confirmation }),
    ).rejects.toThrow(/预览已过期|版本/);
    expect(await opening()).toEqual(old);
  });
  it('直接金额仍要求编辑及导入权限；已结账、核算锁拒绝', async () => {
    const viewer = caller(
      app,
      await app.addUser('view', { permissions: ['inventory.view', 'inventory.import'] }),
    );
    await expect(
      viewer.saveOpening({ warehouseId, revision: 0, rows: [amountRow()] }),
    ).rejects.toThrow(/权限/);
    await expect(
      viewer.importPreview({ kind: 'opening', warehouseId, revision: 0, rows: [amountRow()] }),
    ).rejects.toThrow(/权限/);
    const editor = caller(
      app,
      await app.addUser('edit', { permissions: ['inventory.view', 'inventory.edit'] }),
    );
    await expect(
      editor.importPreview({ kind: 'opening', warehouseId, revision: 0, rows: [amountRow()] }),
    ).rejects.toThrow(/权限/);
    await save([amountRow()]);
    const payload = {
      kind: 'opening' as const,
      warehouseId,
      revision: 1,
      rows: [amountRow()],
      overwrite: true,
    };
    const p = await api.importPreview(payload);
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(save([amountRow()])).rejects.toThrow(/结账/);
    await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow(
      /结账/,
    );
    await app.svc.periods.setStatus(202601, 'open');
    await app.svc.db
      .withTables<InventoryTables>()
      .updateTable('inventory_control')
      .set({ cost_period: 202601, cost_cutoff_date: '2026-01-31' })
      .where('id', '=', 1)
      .execute();
    await expect(save([amountRow()])).rejects.toThrow(/锁定/);
    await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow(
      /锁定/,
    );
    expect((await opening()).rows[0]!.amountCents).toBe(100);
  });
});

describe('w_cb_qc：真实XLSX预览、导出与回导', () => {
  async function xlsx(headers: string[], values: unknown[][]) {
    const wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet('期初');
    ws.addRow(headers);
    for (const row of values) ws.addRow(row);
    return readInventoryXlsx(new Uint8Array(await wb.xlsx.writeBuffer()).buffer, 'opening');
  }
  it('混合口径导出仅保留各行有效输入，XLSX→预览→替换回导保持分、数量、口径与反算价', async () => {
    await save([amountRow(101), priceRow()]);
    const old = await opening(),
      columns = importExportColumns('opening');
    const parsed = await xlsx(
      columns.map((c) => c.title),
      old.rows.map((r) => columns.map((c) => c.value(r))),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { productCode: 'P1', quantity: '3', valueBasis: 'amount', amountCents: 101 },
      { productCode: 'P2', quantity: '2.5', valueBasis: 'unitPrice', unitPrice: '3.33' },
    ]);
    const payload = {
      kind: 'opening' as const,
      warehouseId,
      revision: old.revision,
      overwrite: true,
      ...parsed,
    };
    const p = await api.importPreview(payload);
    expect(p.errors).toEqual([]);
    expect(p.amounts).toEqual({ netCents: 934, taxCents: 0, grossCents: 934 });
    expect(await opening()).toEqual(old);
    await api.importSave({ ...payload, confirmation: p.confirmation });
    expect(
      (await opening()).rows.map(
        ({ productCode, quantity, unitPrice, amountCents, valueBasis }) => ({
          productCode,
          quantity,
          unitPrice,
          amountCents,
          valueBasis,
        }),
      ),
    ).toEqual(
      old.rows.map(({ productCode, quantity, unitPrice, amountCents, valueBasis }) => ({
        productCode,
        quantity,
        unitPrice,
        amountCents,
        valueBasis,
      })),
    );
  });
  it('旧三列表兼容；未选口径金额、双输入、空错口径、金额超两位小数不能默默覆盖', async () => {
    const legacy = await xlsx(['产品编号', '数量', '单价'], [['P1', '2', '1.01']]);
    expect(legacy.errors).toEqual([]);
    expect(
      (await api.importPreview({ kind: 'opening', warehouseId, revision: 0, ...legacy })).errors,
    ).toEqual([]);
    for (const [basis, price, amount] of [
      [null, null, '1.00'],
      ['错', null, '1.00'],
      ['直接金额', '2', '1.00'],
      ['数量×单价', '2', '1.00'],
      ['直接金额', null, '0.001'],
      ['直接金额', null, '-1'],
    ] as const) {
      const parsed = await xlsx(
        ['产品编号', '数量', '保存口径', '单价', '金额'],
        [['P1', '3', basis, price, amount]],
      );
      const payload = { kind: 'opening' as const, warehouseId, revision: 0, ...parsed };
      const p = await api.importPreview(payload);
      expect(parsed.errors.length + p.errors.length).toBeGreaterThan(0);
      await expect(api.importSave({ ...payload, confirmation: p.confirmation })).rejects.toThrow();
      expect((await opening()).rows).toEqual([]);
    }
    const missingBasis = {
      kind: 'opening' as const,
      warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity: '3', amountCents: 100 }],
    };
    const p = await api.importPreview(missingBasis);
    expect(p.errors[0]?.message).toContain('明确选择');
  });
});
