import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import server from '../server';
import type { ExchangeFile } from '../exchange';
import type { InventoryTables } from '../server/migrations';

let target: Awaited<ReturnType<typeof setup>>;
const apps: TestApp[] = [];
async function setup() {
  const a = await createTestApp({ modules: [server], product: 'chengben' });
  apps.push(a);
  const api = a.call(server);
  const warehouseId = await api.saveWarehouse({ code: '01', name: '合同反冲仓' });
  await api.saveProduct({ code: 'P1', name: '合同产品' });
  const accountId = (await a.svc.accounts.require('1001')).id;
  const costAccountId = (await a.svc.accounts.require('6401')).id;
  const supplierId = (await a.svc.dimensions.getByCode('partner', 'S001'))!.id;
  const contract = await api.saveContract({
    number: 'HT10',
    warehouseId,
    supplierId,
    date: '2026-01-05',
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.5' }],
  });
  const receive = async (number: string, quantity = '10') =>
    api.saveDocument({
      ...(await api.contractDraft({ id: contract.id })),
      number,
      accountId,
      lines: [{ productCode: 'P1', quantity, unitPrice: '2.5' }],
    });
  return { a, api, warehouseId, accountId, costAccountId, contract, receive };
}
async function source() {
  const s = await setup();
  const first = await s.receive('R1');
  const reversal = await s.api.reverseDocument({
    id: first.id,
    revision: first.revision,
    requestKey: randomUUID(),
    number: 'I1',
    date: '2026-01-10',
    accountId: s.costAccountId,
    confirmed: true,
  });
  const second = await s.receive('R2');
  expect((await s.api.contractFulfillment({ id: s.contract.id })).rows[0]).toMatchObject({
    planned: '10',
    received: '10',
    remaining: '0',
  });
  return { ...s, first, reversal, second };
}
async function snapshot(s: Awaited<ReturnType<typeof setup>>, requestKey = 'unused') {
  const documents = await s.api.documents({});
  const db = s.a.svc.db.withTables<InventoryTables>();
  return {
    documents: await Promise.all(documents.map((d) => s.api.document({ id: d.id }))),
    contract: await s.api.contract({ id: s.contract.id }),
    fulfillment: await s.api.contractFulfillment({ id: s.contract.id }),
    stock: await s.api.stock({ warehouseId: s.warehouseId }),
    context: await s.api.context(),
    requests: await db.selectFrom('inventory_request').selectAll().orderBy('request_key').execute(),
    reversals: await db
      .selectFrom('inventory_reversal')
      .selectAll()
      .orderBy('original_document_id')
      .execute(),
    transfers: await db.selectFrom('inventory_transfer').selectAll().orderBy('id').execute(),
    logs: await s.a.svc.log.list(),
    imported: await s.a.svcFor('inventory').settings.get(`document-import.${requestKey}`, null),
  };
}
beforeEach(async () => {
  target = await setup();
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

it.each([
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
])(
  'ht1/ht2/w_ck_rk：真实三单按 %i/%i/%i 导出，合同10、入库10、反冲10、再入库10完整往返',
  async (...order) => {
    const s = await source();
    const ids = [s.first.id, s.reversal.id, s.second.id];
    const file = JSON.parse(
      JSON.stringify(
        await s.api.exportDocuments({
          ids: order.map((i) => ids[i]!),
        }),
      ),
    ) as ExchangeFile;
    const { api } = target;
    const input = { file, requestKey: randomUUID() };
    const preview = await api.importDocumentsPreview(input);
    expect(preview.errors).toEqual([]);
    expect(await api.documents({})).toEqual([]);
    const saved = await api.importDocuments({ ...input, confirmation: preview.confirmation });
    expect(saved.savedIds).toHaveLength(3);
    const contract = (await api.contracts({}))[0]!;
    expect((await api.contractFulfillment({ id: contract.id })).rows[0]).toMatchObject({
      planned: '10',
      received: '10',
      remaining: '0',
    });
    const exported = await api.exportDocuments({ ids: saved.savedIds });
    expect(exported).toEqual(file);
    expect((await api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('10');
    const original = await api.document({ id: saved.savedIds[order.indexOf(0)]! });
    const reversed = await api.document({ id: saved.savedIds[order.indexOf(1)]! });
    expect(original.revision).toBe(2);
    expect(original.source_type).toBe('contract');
    expect(original.source_id).toBe(contract.id);
    expect(reversed.source_id).toBe(original.id);
    expect(reversed.reversal?.original_document_id).toBe(original.id);
    await expect(
      api.removeDocument({ id: original.id, revision: original.revision, confirmed: true }),
    ).rejects.toThrow(/反冲/);
    await expect(
      api.saveDocument({
        ...(await api.copyDocument({ id: reversed.id })),
        id: reversed.id,
        revision: reversed.revision,
        number: reversed.number,
      }),
    ).rejects.toThrow(/反冲/);
  },
);

it('w_cb_ck_copy/w_ck_rk：恢复额度已被再入库使用时，删除反冲拒绝并保持数据不变', async () => {
  const s = await source();
  const before = await snapshot(s);
  await expect(
    s.api.removeDocument({
      id: s.reversal.id,
      revision: s.reversal.revision,
      confirmed: true,
    }),
  ).rejects.toThrow(/合同/);
  expect(await snapshot(s)).toEqual(before);
  await s.api.removeDocument({ id: s.second.id, revision: s.second.revision, confirmed: true });
  await s.api.removeDocument({ id: s.reversal.id, revision: s.reversal.revision, confirmed: true });
  expect((await s.api.contractFulfillment({ id: s.contract.id })).rows[0]).toMatchObject({
    received: '10',
    remaining: '0',
  });
  expect((await s.api.document({ id: s.first.id })).reversal).toBeUndefined();
});

it('ht1/ht2/w_ck_rk：多次整单退回再采购逐对恢复额度，同产品多行不丢数量或金额', async () => {
  const s = await source();
  const secondReversal = await s.api.reverseDocument({
    id: s.second.id,
    revision: s.second.revision,
    requestKey: randomUUID(),
    number: 'I2',
    date: '2026-01-11',
    accountId: s.costAccountId,
    confirmed: true,
  });
  const third = await s.api.saveDocument({
    ...(await s.api.contractDraft({ id: s.contract.id })),
    number: 'R3',
    accountId: s.accountId,
    lines: [
      { productCode: 'P1', quantity: '4', unitPrice: '2.5' },
      { productCode: 'P1', quantity: '6', unitPrice: '2.5' },
    ],
  });
  const file = JSON.parse(
    JSON.stringify(
      await s.api.exportDocuments({
        ids: [third.id, s.second.id, s.first.id, secondReversal.id, s.reversal.id],
      }),
    ),
  ) as ExchangeFile;
  const input = { file, requestKey: randomUUID() };
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  const result = await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  const canonical = (f: ExchangeFile) =>
    f.version === 1
      ? f
      : {
          ...f,
          relations: {
            ...f.relations,
            reversals: [...f.relations.reversals].sort((a, b) =>
              a.originalKey.localeCompare(b.originalKey),
            ),
          },
        };
  expect(canonical(await target.api.exportDocuments({ ids: result.savedIds }))).toEqual(
    canonical(file),
  );
  expect((await target.api.contractFulfillment({ id: target.contract.id })).rows[0]).toMatchObject({
    received: '10',
    remaining: '0',
  });
});

it.each(['入库占额', '合同减量', '合同备注', '合同取消'] as const)(
  'ht1/ht2/w_ck_rk：预览后外部%s，正式转入复核拒绝且不改变外部结果',
  async (change) => {
    const s = await source();
    const file = await s.api.exportDocuments({ ids: [s.second.id, s.reversal.id, s.first.id] });
    const input = { file, requestKey: randomUUID() };
    const p = await target.api.importDocumentsPreview(input);
    expect(p.errors).toEqual([]);
    if (change === '入库占额') await target.receive('EXTERNAL', '1');
    else if (change === '合同减量' || change === '合同备注')
      await target.api.saveContract({
        id: target.contract.id,
        revision: target.contract.revision,
        number: 'HT10',
        warehouseId: target.warehouseId,
        supplierId: target.contract.supplier_id,
        date: target.contract.date,
        note: '预览后合同变更',
        lines: [
          { productCode: 'P1', quantity: change === '合同减量' ? '9' : '10', unitPrice: '2.5' },
        ],
      });
    else
      await target.api.setContractStatus({
        id: target.contract.id,
        revision: target.contract.revision,
        status: 'cancelled',
        confirmed: true,
      });
    const before = await snapshot(target, input.requestKey);
    await expect(
      target.api.importDocuments({ ...input, confirmation: p.confirmation }),
    ).rejects.toThrow(/未保存|预览已过期/);
    expect(await snapshot(target, input.requestKey)).toEqual(before);
  },
);

it('w_ck_rk/w_ck_ck：反冲关联已落库后末张入库真实失败，全批头行、关系、版本、日志和请求均回滚', async () => {
  const s = await source();
  const file = await s.api.exportDocuments({ ids: [s.second.id, s.first.id, s.reversal.id] });
  const input = { file, requestKey: randomUUID() };
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  const before = await snapshot(target, input.requestKey);
  await sql`CREATE TEMP TRIGGER inventory_contract_import_fail BEFORE INSERT ON inventory_document
    WHEN NEW.number='R2' AND (SELECT COUNT(*) FROM inventory_reversal)=1
    BEGIN SELECT RAISE(ABORT,'反冲已落库后末张写入失败'); END`.execute(target.a.svc.db);
  await expect(
    target.api.importDocuments({ ...input, confirmation: p.confirmation }),
  ).rejects.toThrow(/反冲已落库后末张写入失败/);
  expect(await snapshot(target, input.requestKey)).toEqual(before);
  await sql`DROP TRIGGER inventory_contract_import_fail`.execute(target.a.svc.db);
  const saved = await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  expect(await target.api.exportDocuments({ ids: saved.savedIds })).toEqual(file);
});

it.each([true, false])(
  'ht1/ht2/w_ck_rk：合同导入与外部末批入库并发（导入先发=%s），只能一方占用额度',
  async (importFirst) => {
    const s = await source();
    const file = await s.api.exportDocuments({ ids: [s.second.id, s.reversal.id, s.first.id] });
    const input = { file, requestKey: randomUUID() };
    const p = await target.api.importDocumentsPreview(input);
    expect(p.errors).toEqual([]);
    const draft = await target.api.contractDraft({ id: target.contract.id });
    const external = () =>
      target.api.saveDocument({
        ...draft,
        number: 'EXTERNAL',
        accountId: target.accountId,
        lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2.5' }],
      });
    const importing = () => target.api.importDocuments({ ...input, confirmation: p.confirmation });
    const tasks = importFirst ? [importing, external] : [external, importing];
    const results = await Promise.allSettled(tasks.map((run) => run()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const fulfillment = await target.api.contractFulfillment({ id: target.contract.id });
    expect(['1', '10']).toContain(fulfillment.rows[0]?.received);
    expect(['9', '0']).toContain(fulfillment.rows[0]?.remaining);
    const saved = await target.api.documents({});
    expect(saved.map((d) => d.number).sort()).toEqual(
      saved.length === 1 ? ['EXTERNAL'] : ['I1', 'R1', 'R2'],
    );
  },
);

it('w_ck_rk/w_ck_ck：普通反冲保持整批先入后出，已有负库存被本批补足时无需新增负库存确认', async () => {
  const s = await setup();
  const first = await s.api.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId: s.warehouseId,
    number: 'R1',
    date: '2026-01-05',
    category: '采购',
    accountId: s.accountId,
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.5' }],
  });
  const reversal = await s.api.reverseDocument({
    id: first.id,
    revision: first.revision,
    requestKey: randomUUID(),
    number: 'I1',
    date: '2026-01-10',
    accountId: s.costAccountId,
    confirmed: true,
  });
  const replenishment = await s.api.saveDocument({
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId: s.warehouseId,
    number: '补足入库',
    date: '2026-01-11',
    category: '采购',
    accountId: s.accountId,
    lines: [{ productCode: 'P1', quantity: '5', unitPrice: '2.5' }],
  });
  const issue = {
    requestKey: randomUUID(),
    kind: 'issue' as const,
    warehouseId: target.warehouseId,
    number: '已确认负库存',
    date: '2026-01-05',
    category: '领用' as const,
    costAccountId: target.costAccountId,
    lines: [{ productCode: 'P1', quantity: '5', unitPrice: '2.5' }],
  };
  const negative = await target.api.previewDocument(issue);
  await target.api.saveDocument({ ...issue, negativeConfirmation: negative.confirmation });
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('-5');
  const input = {
    file: await s.api.exportDocuments({ ids: [first.id, reversal.id, replenishment.id] }),
    requestKey: randomUUID(),
  };
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('0');
});

it('w_cb_ck_copy/w_ck_rk：合同允许撤销反冲但后续写入失败时，删除、关联及原单版本全部回滚', async () => {
  const first = await target.receive('R1');
  const reversal = await target.api.reverseDocument({
    id: first.id,
    revision: first.revision,
    requestKey: randomUUID(),
    number: 'I1',
    date: '2026-01-10',
    accountId: target.costAccountId,
    confirmed: true,
  });
  const before = await snapshot(target);
  await sql`CREATE TEMP TRIGGER inventory_contract_undo_fail BEFORE UPDATE ON inventory_document
    BEGIN SELECT RAISE(ABORT,'撤销反冲更新原单失败'); END`.execute(target.a.svc.db);
  await expect(
    target.api.removeDocument({ id: reversal.id, revision: reversal.revision, confirmed: true }),
  ).rejects.toThrow(/撤销反冲更新原单失败/);
  expect(await snapshot(target)).toEqual(before);
});
