import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { priceLine } from '../math';
import { ExchangeFileSchema, type ExchangeDocument, type ExchangeFile } from '../exchange';
import { exportDocuments, importDocuments } from '../server/exchange';
import { inventoryTransfer } from '../server/transfer';
import { inventoryReversal } from '../server/reversal';
import type { InventoryTables } from '../server/migrations';

let app: TestApp;
let warehouseId: number;
let cashId: number;
let costId: number;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;
const svc = () => app.svcFor('inventory');
function document(
  number = 'R1',
  kind: 'receipt' | 'issue' = 'receipt',
  amount = '5',
): ExchangeDocument {
  const p = priceLine(amount, '113', '13', true);
  return {
    key: number,
    kind,
    warehouseCode: '01',
    number,
    date: '2026-01-10',
    category: kind === 'receipt' ? '采购' : '销售',
    operator: '张会计',
    summary: '完整头行转入',
    accountCode: '1001',
    costAccountCode: kind === 'issue' ? '6401' : null,
    taxRate: '13',
    source: null,
    lines: [
      {
        productCode: 'P1',
        quantity: amount,
        unitPrice: '113',
        priceIncludesTax: true,
        note: '保留含税口径',
        netCents: p.net_cents,
        taxCents: p.tax_cents,
        grossCents: p.gross_cents,
      },
    ],
  };
}
function file(documents: ExchangeDocument[] = [document()]): ExchangeFile {
  return { format: 'caiwu.inventory.documents', version: 1, documents };
}
async function commit(inputFile = file(), allowNegative = false) {
  const payload = { file: inputFile, requestKey: randomUUID(), allowNegative };
  const preview = await importDocuments(svc(), payload);
  expect(preview.errors).toEqual([]);
  return importDocuments(svc(), { ...payload, confirmation: preview.confirmation }, true);
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '文件仓库' });
  await api.saveProduct({ code: 'P1', name: '完整单据产品' });
  cashId = (await app.svc.accounts.require('1001')).id;
  costId = (await app.svc.accounts.require('6401')).id;
});
afterEach(async () => app.close());

describe('w_ck_rk/w_ck_ck 多单完整头行转入转出', () => {
  it('w_ck_rk：多单金额合计超出转入允许范围时不生成无法回导的文件', async () => {
    const ids = [];
    for (const number of ['BIG-1', 'BIG-2', 'BIG-3']) {
      const d = await api.saveDocument({
        requestKey: randomUUID(),
        kind: 'receipt',
        warehouseId,
        number,
        date: '2026-01-10',
        category: '采购',
        accountId: cashId,
        lines: [{ productCode: 'P1', quantity: '999999999', unitPrice: '40000' }],
      });
      ids.push(d.id);
    }
    await expect(exportDocuments(svc(), { ids })).rejects.toThrow(/金额合计超出/);
    expect(await api.documents({})).toHaveLength(3);
  });
  it('ht1/ht2/w_ck_rk：同一合同多张入库合并预检，整批超量拒绝且不改合同与库存', async () => {
    const supplierId = (await app.svc.dimensions.getByCode('partner', 'S001'))!.id;
    await api.saveContract({
      number: 'HT1',
      warehouseId,
      supplierId,
      date: '2026-01-01',
      lines: [{ productCode: 'P1', quantity: '5', unitPrice: '1' }],
    });
    const first = document('R1', 'receipt', '3'),
      second = document('R2', 'receipt', '3');
    first.source = second.source = { type: 'contract', number: 'HT1' };
    const payload = { file: file([first, second]), requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    expect(p.errors.some((e) => e.document === 2 && /整批入库超过/.test(e.message))).toBe(true);
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/未保存/);
    expect(await api.documents({})).toEqual([]);
    expect((await api.stock({ warehouseId }))[0]?.balance).toBe('0');
  });

  it('w_ck_rk/w_ck_ck：剥离反冲关系的旧版和新版文件均拒绝，不生成可任意改写的伪反冲单', async () => {
    const original = document('ORIGINAL', 'receipt', '2'),
      reversal = document('REVERSE', 'issue', '2');
    reversal.category = '其他出库';
    reversal.source = {
      type: 'document',
      kind: 'receipt',
      warehouseCode: '01',
      number: original.number,
    };
    for (const inputFile of [
      file([original, reversal]),
      { ...file([original, reversal]), version: 2, relations: { transfers: [], reversals: [] } },
    ]) {
      const payload = { file: inputFile, requestKey: randomUUID() };
      const p = await importDocuments(svc(), payload);
      expect(p.errors.some((e) => /反冲关联/.test(e.message))).toBe(true);
      await expect(
        importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
      ).rejects.toThrow(/未保存/);
    }
    expect(await api.documents({})).toEqual([]);
  });

  it('w_ck_rk1/w_ck_ck1：发票种类随完整头行往返，旧文件省略时保留不指定', async () => {
    const special = document('SPECIAL');
    special.invoiceKind = 'special';
    const result = await commit(file([special, document('LEGACY')]));
    expect((await api.document({ id: result.savedIds[0]! })).invoice_kind).toBe('special');
    expect((await api.document({ id: result.savedIds[1]! })).invoice_kind).toBe('none');
    expect(
      (await exportDocuments(svc(), { ids: result.savedIds })).documents.map((d) => d.invoiceKind),
    ).toEqual(['special', 'none']);
  });
  it('整批预览没有写入，入出库两单按依赖次序保存并保留输入顺序、税口径和全部头行', async () => {
    const inputFile = file([document('S1', 'issue', '4'), document('R1', 'receipt', '5')]);
    const payload = { file: inputFile, requestKey: randomUUID() };
    const preview = await importDocuments(svc(), payload);
    expect(preview.errors).toEqual([]);
    expect(preview.shortages).toEqual([]);
    expect(preview.rows.map((r) => r.number)).toEqual(['S1', 'R1']);
    expect(preview.totals).toEqual({ netCents: 90000, taxCents: 11700, grossCents: 101700 });
    expect(await api.documents({})).toEqual([]);
    const result = await importDocuments(
      svc(),
      { ...payload, confirmation: preview.confirmation },
      true,
    );
    expect(result.saved).toBe(true);
    expect(result.savedIds).toHaveLength(2);
    const saved = await api.document({ id: result.savedIds[0]! });
    expect(saved).toMatchObject({
      number: 'S1',
      kind: 'issue',
      warehouse_id: warehouseId,
      date: '2026-01-10',
      category: '销售',
      operator: '张会计',
      summary: '完整头行转入',
      account_id: cashId,
      cost_account_id: costId,
      tax_rate: '13',
      audited_by: null,
      voucher_id: null,
    });
    expect(saved.lines[0]).toMatchObject({
      productCode: 'P1',
      quantity: '4',
      unitPrice: '113',
      priceIncludesTax: true,
      note: '保留含税口径',
      net_cents: 40000,
      tax_cents: 5200,
      gross_cents: 45200,
    });
    expect((await api.stock({ warehouseId }))[0]?.balance).toBe('1');
  });

  it('可移植文件只含档案编码，跨账套映射不同ID，转出头行再转入金额一致', async () => {
    const saved = await commit(file([document('R1'), document('R2')]));
    const exported = await exportDocuments(svc(), { ids: saved.savedIds });
    expect(ExchangeFileSchema.parse(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    expect(JSON.stringify(exported)).not.toMatch(
      /"(?:id|warehouseId|productId|accountId|sourceId|voucherId)"/,
    );
    const target = await createTestApp({ modules: [server], product: 'chengben' });
    try {
      const targetApi = target.call(server);
      await targetApi.saveWarehouse({ code: 'OTHER', name: '不同ID' });
      const targetWarehouse = await targetApi.saveWarehouse({ code: '01', name: '目标仓' });
      await targetApi.saveProduct({ code: 'OTHER', name: '不同产品ID' });
      await targetApi.saveProduct({ code: 'P1', name: '目标产品' });
      expect(targetWarehouse).not.toBe(warehouseId);
      const payload = { file: exported, requestKey: randomUUID() };
      const p = await importDocuments(target.svcFor('inventory'), payload);
      expect(p.errors).toEqual([]);
      const result = await importDocuments(
        target.svcFor('inventory'),
        { ...payload, confirmation: p.confirmation },
        true,
      );
      const d = await targetApi.document({ id: result.savedIds[0]! });
      expect(d.warehouse_id).toBe(targetWarehouse);
      expect(d.lines[0]).toMatchObject({
        productCode: 'P1',
        quantity: '5',
        net_cents: 50000,
        tax_cents: 6500,
        gross_cents: 56500,
      });
    } finally {
      await target.close();
    }
  });

  it('重试、并发重试只落一次，已使用的导入编号不能换内容', async () => {
    const payload = { file: file(), requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    const input = { ...payload, confirmation: p.confirmation };
    const [first, second] = await Promise.all([
      importDocuments(svc(), input, true),
      importDocuments(svc(), input, true),
    ]);
    expect(first.savedIds).toEqual(second.savedIds);
    expect(await api.documents({})).toHaveLength(1);
    await expect(
      importDocuments(svc(), { ...input, file: file([document('CHANGED')]) }, true),
    ).rejects.toThrow(/编号已经用于其他内容/);
    expect(await api.documents({})).toHaveLength(1);
  });

  it('后张单据真实写入失败时，已保存的前张、库存版本、操作日志和幂等记录一起回滚', async () => {
    const payload = { file: file([document('R1'), document('FAIL')]), requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    const before = (await api.context()).control.stock_revision;
    await sql
      .raw(
        "CREATE TEMP TRIGGER inventory_exchange_test_fail BEFORE INSERT ON inventory_document WHEN NEW.number='FAIL' BEGIN SELECT RAISE(ABORT,'模拟磁盘写入失败'); END",
      )
      .execute(app.svc.db);
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/模拟磁盘写入失败/);
    expect(await api.documents({})).toEqual([]);
    expect((await api.context()).control.stock_revision).toBe(before);
    expect(await svc().settings.get(`document-import.${payload.requestKey}`, null)).toBeNull();
    expect(
      await app.svc.db
        .withTables<InventoryTables>()
        .selectFrom('inventory_request')
        .selectAll()
        .execute(),
    ).toEqual([]);
    const logs = await app.svc.db
      .selectFrom('operation_log')
      .selectAll()
      .where('action', 'like', 'inventory.document%')
      .execute();
    expect(logs).toEqual([]);
    await sql.raw('DROP TRIGGER inventory_exchange_test_fail').execute(app.svc.db);
    const retried = await importDocuments(
      svc(),
      { ...payload, confirmation: p.confirmation },
      true,
    );
    expect(retried.savedIds).toHaveLength(2);
  });

  it.each([
    ['错误版本', (f: ExchangeFile) => ({ ...f, version: 9 })],
    [
      '未知头字段',
      (f: ExchangeFile) => ({ ...f, documents: [{ ...f.documents[0], warehouseId: 1 }] }),
    ],
    [
      '缺失含税口径',
      (f: ExchangeFile) => {
        const copy = structuredClone(f);
        delete (copy.documents[0]!.lines[0] as Partial<ExchangeDocument['lines'][number]>)
          .priceIncludesTax;
        return copy;
      },
    ],
    [
      '未知产品',
      (f: ExchangeFile) => {
        const copy = structuredClone(f);
        copy.documents[0]!.lines[0]!.productCode = 'UNKNOWN';
        return copy;
      },
    ],
    [
      '伪造金额',
      (f: ExchangeFile) => {
        const copy = structuredClone(f);
        copy.documents[0]!.lines[0]!.grossCents++;
        return copy;
      },
    ],
    [
      '重复单据标识',
      (f: ExchangeFile) => ({
        ...f,
        documents: [f.documents[0], { ...f.documents[0], number: 'R2' }],
      }),
    ],
    [
      '重复单号',
      (f: ExchangeFile) => ({
        ...f,
        documents: [f.documents[0], { ...f.documents[0], key: 'OTHER' }],
      }),
    ],
  ])('%s：逐单或逐行报错，整个批次不能写入', async (_label, change) => {
    const payload = { file: change(file()), requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    expect(p.errors.length).toBeGreaterThan(0);
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/未保存任何数据/);
    expect(await api.documents({})).toEqual([]);
  });

  it('当前账套同号拒绝覆盖；档案、库存或期间变化使预览失效', async () => {
    await commit();
    const duplicate = await importDocuments(svc(), { file: file(), requestKey: randomUUID() });
    expect(duplicate.errors[0]?.message).toMatch(/重复/);
    const payload = { file: file([document('R2')]), requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    await api.saveProduct({ code: 'P2', name: '预览后变化' });
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/预览已过期/);
    expect(await api.documents({})).toHaveLength(1);
    await app.svc.periods.setStatus(202601, 'closed');
    const locked = await importDocuments(svc(), {
      file: file([document('R3')]),
      requestKey: randomUUID(),
    });
    expect(locked.errors[0]?.message).toMatch(/结账|结帐|关闭/);
  });

  it('累计多单出库数量检查，默认取消；明确勾选并重新预览后才能负库存', async () => {
    const inputFile = file([
      document('R1'),
      document('S1', 'issue', '3'),
      document('S2', 'issue', '3'),
    ]);
    const payload = { file: inputFile, requestKey: randomUUID(), allowNegative: false };
    const p = await importDocuments(svc(), payload);
    expect(p.shortages).toEqual([
      {
        document: 3,
        number: 'S2',
        productCode: 'P1',
        current: '2',
        requested: '3',
        difference: '1',
      },
    ]);
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/尚未明确确认/);
    expect(await api.documents({})).toEqual([]);
    const allowed = { ...payload, allowNegative: true };
    await expect(
      importDocuments(svc(), { ...allowed, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/预览已过期/);
    const fresh = await importDocuments(svc(), allowed);
    await importDocuments(svc(), { ...allowed, confirmation: fresh.confirmation }, true);
    expect((await api.stock({ warehouseId }))[0]?.balance).toBe('-1');
  });

  it('来源单据用仓库编码、方向和单号解析，循环来源和不存在来源拒绝', async () => {
    const first = document('R1');
    const next = document('R2');
    next.source = { type: 'document', warehouseCode: '01', kind: 'receipt', number: 'R1' };
    const result = await commit(file([next, first]));
    expect((await api.document({ id: result.savedIds[0]! })).source_id).toBe(result.savedIds[1]);
    const a = document('A'),
      b = document('B');
    a.source = { type: 'document', warehouseCode: '01', kind: 'receipt', number: 'B' };
    b.source = { type: 'document', warehouseCode: '01', kind: 'receipt', number: 'A' };
    const cycle = await importDocuments(svc(), { file: file([a, b]), requestKey: randomUUID() });
    expect(cycle.errors).toContainEqual({ document: 0, message: expect.stringContaining('循环') });
    a.source.number = 'UNKNOWN';
    const missing = await importDocuments(svc(), { file: file([a]), requestKey: randomUUID() });
    expect(missing.errors[0]?.message).toMatch(/来源单据 UNKNOWN/);
  });

  it('登录与查看、维护、导入权限分别由服务端检查，导入权限不能代替维护权限', async () => {
    const read = app.call(server, await app.addUser('view', { permissions: ['inventory.view'] }));
    const importing = app.call(
      server,
      await app.addUser('import', { permissions: ['inventory.import'] }),
    );
    const editing = app.call(
      server,
      await app.addUser('edit', { permissions: ['inventory.edit'] }),
    );
    const all = app.call(
      server,
      await app.addUser('all', {
        permissions: ['inventory.view', 'inventory.import', 'inventory.edit'],
      }),
    );
    const payload = { file: file(), requestKey: randomUUID() };
    await expect(read.importDocumentsPreview(payload)).rejects.toThrow(/权限/);
    await expect(importing.importDocumentsPreview(payload)).rejects.toThrow(/权限/);
    await expect(editing.importDocumentsPreview(payload)).rejects.toThrow(/权限/);
    await expect(app.call(server, null).importDocumentsPreview(payload)).rejects.toThrow(/登录/);
    const p = await all.importDocumentsPreview(payload);
    expect(p.errors).toEqual([]);
    await all.importDocuments({ ...payload, confirmation: p.confirmation });
    const ids = (await api.documents({})).map((d) => d.id);
    expect((await read.exportDocuments({ ids })).documents).toHaveLength(1);
    await expect(editing.exportDocuments({ ids })).rejects.toThrow(/权限/);
  });

  it('调拨和反冲必须明确补选另一端，完整集合以文件标识保留关联并真实跨账套恢复', async () => {
    const targetWarehouseId = await api.saveWarehouse({ code: '02', name: '调入仓' });
    const sourceDocument = await api.saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'BASE',
      date: '2026-01-10',
      category: '采购',
      accountId: cashId,
      lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.55' }],
    });
    const transfer = await inventoryTransfer(svc()).save({
      requestKey: randomUUID(),
      number: 'DB1',
      sourceWarehouseId: warehouseId,
      targetWarehouseId,
      date: '2026-01-11',
      clearingAccountId: cashId,
      lines: [{ productCode: 'P1', quantity: '3', unitPrice: '2.55' }],
    });
    const original = await api.saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId,
      number: 'ORIGINAL',
      date: '2026-01-10',
      category: '采购',
      accountId: cashId,
      taxRate: '13',
      lines: [{ productCode: 'P1', quantity: '2', unitPrice: '113', priceIncludesTax: true }],
    });
    const audited = await api.audit({ id: original.id, revision: original.revision, to: true });
    const reversal = await inventoryReversal(svc()).save({
      id: audited.id,
      revision: audited.revision,
      requestKey: randomUUID(),
      number: 'REVERSED',
      date: '2026-01-12',
      accountId: costId,
      confirmed: true,
    });
    for (const ids of [[original.id], [reversal.id], [transfer.issue.id], [transfer.receipt.id]])
      await expect(exportDocuments(svc(), { ids })).rejects.toThrow(/缺少关联/);
    const selected = [
      transfer.receipt.id,
      reversal.id,
      sourceDocument.id,
      transfer.issue.id,
      original.id,
    ];
    const exported = await exportDocuments(svc(), { ids: selected });
    expect(exported.version).toBe(2);
    if (exported.version !== 2) throw new Error('缺少关联文件版本');
    expect(exported.relations).toEqual({
      transfers: [{ number: 'DB1', issueKey: 'document-4', receiptKey: 'document-1' }],
      reversals: [{ originalKey: 'document-5', reversalKey: 'document-2' }],
    });
    expect(exported.documents.map((d) => d.number)).toEqual([
      '调入-DB1',
      'REVERSED',
      'BASE',
      '调出-DB1',
      'ORIGINAL',
    ]);
    const target = await createTestApp({ modules: [server], product: 'chengben' });
    try {
      const targetApi = target.call(server),
        targetSvc = target.svcFor('inventory');
      await targetApi.saveWarehouse({ code: 'OTHER', name: '不同仓库ID' });
      const target01 = await targetApi.saveWarehouse({ code: '01', name: '目标调出仓' });
      const target02 = await targetApi.saveWarehouse({ code: '02', name: '目标调入仓' });
      await targetApi.saveProduct({ code: 'P1', name: '目标产品' });
      const payload = { file: exported, requestKey: randomUUID() };
      const p = await importDocuments(targetSvc, payload);
      expect(p.errors).toEqual([]);
      expect(p.shortages).toEqual([]);
      expect(p.relations).toEqual(exported.relations);
      const db = target.svc.db.withTables<InventoryTables>();
      await sql
        .raw(
          "CREATE TEMP TRIGGER inventory_exchange_relation_fail BEFORE INSERT ON inventory_reversal BEGIN SELECT RAISE(ABORT,'模拟关联写入失败'); END",
        )
        .execute(db);
      await expect(
        importDocuments(targetSvc, { ...payload, confirmation: p.confirmation }, true),
      ).rejects.toThrow(/模拟关联写入失败/);
      expect(await targetApi.documents({})).toEqual([]);
      expect(await db.selectFrom('inventory_transfer').selectAll().execute()).toEqual([]);
      expect(await db.selectFrom('inventory_reversal').selectAll().execute()).toEqual([]);
      expect(
        await targetSvc.settings.get(`document-import.${payload.requestKey}`, null),
      ).toBeNull();
      await sql.raw('DROP TRIGGER inventory_exchange_relation_fail').execute(db);
      const result = await importDocuments(
        targetSvc,
        { ...payload, confirmation: p.confirmation },
        true,
      );
      expect(result.savedIds).toHaveLength(5);
      const transferred = (await inventoryTransfer(targetSvc).list({}))[0]!;
      expect(transferred).toMatchObject({
        number: 'DB1',
        issue_document_id: result.savedIds[3],
        receipt_document_id: result.savedIds[0],
        created_by: target.svc.user.id,
      });
      const restored = await db
        .selectFrom('inventory_reversal')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(restored).toMatchObject({
        original_document_id: result.savedIds[4],
        reversal_document_id: result.savedIds[1],
        created_by: target.svc.user.id,
      });
      const restoredOriginal = await targetApi.document({ id: result.savedIds[4]! });
      expect(restoredOriginal).toMatchObject({
        number: 'ORIGINAL',
        audited_by: null,
        voucher_id: null,
        calculation_status: 'uncalculated',
        revision: 2,
      });
      const restoredReversal = await targetApi.document({ id: result.savedIds[1]! });
      expect(restoredReversal.source_id).toBe(restoredOriginal.id);
      expect(restoredReversal.lines[0]).toMatchObject({
        quantity: '2',
        unitPrice: '113',
        priceIncludesTax: true,
        net_cents: 20000,
        tax_cents: 2600,
        gross_cents: 22600,
      });
      await expect(
        targetApi.removeDocument({
          id: restoredOriginal.id,
          revision: restoredOriginal.revision,
          confirmed: true,
        }),
      ).rejects.toThrow(/反冲/);
      await expect(
        targetApi.removeDocument({
          id: transferred.issue_document_id,
          revision: transferred.issueRevision,
          confirmed: true,
        }),
      ).rejects.toThrow(/调拨/);
      expect((await targetApi.stock({ warehouseId: target01 }))[0]?.balance).toBe('7');
      expect((await targetApi.stock({ warehouseId: target02 }))[0]?.balance).toBe('3');
      expect(
        (await importDocuments(targetSvc, { ...payload, confirmation: p.confirmation }, true))
          .savedIds,
      ).toEqual(result.savedIds);
    } finally {
      await target.close();
    }
  });

  it('出库反冲的退回单价和零税率在关联文件中保持，不能自动用销售价替代', async () => {
    await commit(file([document('R1', 'receipt', '10')]));
    const source = await api.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId,
      number: 'SALE',
      date: '2026-01-10',
      category: '销售',
      accountId: cashId,
      costAccountId: costId,
      taxRate: '13',
      lines: [{ productCode: 'P1', quantity: '2', unitPrice: '113', priceIncludesTax: true }],
    });
    const returned = await inventoryReversal(svc()).save({
      id: source.id,
      revision: source.revision,
      requestKey: randomUUID(),
      number: 'RETURN',
      date: '2026-01-11',
      accountId: cashId,
      unitPrices: ['7.25'],
      confirmed: true,
    });
    const exported = await exportDocuments(svc(), { ids: [source.id, returned.id] });
    expect(exported.version).toBe(2);
    expect(exported.documents[1]).toMatchObject({
      taxRate: '0',
      lines: [
        {
          productCode: 'P1',
          quantity: '2',
          unitPrice: '7.25',
          priceIncludesTax: false,
          netCents: 1450,
          taxCents: 0,
          grossCents: 1450,
          note: '',
        },
      ],
    });
  });

  it.each([
    'missing',
    'same',
    'direction',
    'warehouse',
    'quantity',
    'source',
    'reuse',
    'cycle',
    'transfer-price',
    'transfer-tax',
  ])('关联校验 %s：整批错误保留，不能写成不一致或割裂关系', async (variant) => {
    const original = document('OR1', 'receipt', '2');
    const reverse = document('REV1', 'issue', '2');
    reverse.category = '其他出库';
    reverse.source = { type: 'document', warehouseCode: '01', kind: 'receipt', number: 'OR1' };
    const input: ExchangeFile = {
      format: 'caiwu.inventory.documents',
      version: 2,
      documents: [original, reverse],
      relations: {
        transfers: [],
        reversals: [{ originalKey: original.key, reversalKey: reverse.key }],
      },
    };
    if (variant === 'missing') input.relations.reversals[0]!.originalKey = 'MISSING';
    if (variant === 'same') input.relations.reversals[0]!.reversalKey = original.key;
    if (variant === 'direction') reverse.kind = 'receipt';
    if (variant === 'warehouse') reverse.warehouseCode = 'OTHER';
    if (variant === 'quantity') reverse.lines[0]!.quantity = '1';
    if (variant === 'source') reverse.source.number = 'MISSING';
    if (variant === 'reuse')
      input.relations.reversals.push({ originalKey: original.key, reversalKey: reverse.key });
    if (variant === 'cycle') {
      original.source = { type: 'document', warehouseCode: '01', kind: 'issue', number: 'REV1' };
    }
    if (variant.startsWith('transfer-')) {
      original.kind = 'issue';
      original.category = '其他出库';
      original.taxRate = '0';
      original.accountCode = original.costAccountCode = '1001';
      reverse.kind = 'receipt';
      reverse.category = '其他入库';
      reverse.warehouseCode = '02';
      reverse.taxRate = '0';
      reverse.accountCode = reverse.costAccountCode = '1001';
      reverse.source = null;
      original.lines[0]!.priceIncludesTax = reverse.lines[0]!.priceIncludesTax = false;
      input.relations = {
        transfers: [{ number: 'DB1', issueKey: original.key, receiptKey: reverse.key }],
        reversals: [],
      };
      if (variant === 'transfer-price') reverse.lines[0]!.unitPrice = '5';
      if (variant === 'transfer-tax') reverse.taxRate = '13';
    }
    const payload = { file: input, requestKey: randomUUID() };
    const p = await importDocuments(svc(), payload);
    expect(p.errors.length).toBeGreaterThan(0);
    await expect(
      importDocuments(svc(), { ...payload, confirmation: p.confirmation }, true),
    ).rejects.toThrow(/未保存任何数据/);
    expect(await api.documents({})).toEqual([]);
  });
});
