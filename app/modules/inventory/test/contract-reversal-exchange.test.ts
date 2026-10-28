import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import server from '../server';
import type { ExchangeFile } from '../exchange';
import type { InventoryTables } from '../server/migrations';
import { withContractReversalHistory } from '../server/contracts';
import { inventoryService } from '../server/service';
import type { DocumentInput } from '../shared';

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

it('ht1/ht2/w_ck_rk：目标合同已满仍可迁入真实净零反冲历史，普通额外入库仍拒绝', async () => {
  const s = await source();
  await target.receive('TARGET-FULL');
  const input = {
    file: JSON.parse(
      JSON.stringify(await s.api.exportDocuments({ ids: [s.first.id, s.reversal.id] })),
    ) as ExchangeFile,
    requestKey: randomUUID(),
  };
  const before = await snapshot(target);
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  expect(await snapshot(target)).toEqual(before);
  await expect(
    target.api.saveDocument({
      requestKey: randomUUID(),
      kind: 'receipt',
      warehouseId: target.warehouseId,
      number: 'NORMAL-OVER',
      date: '2026-01-11',
      category: '采购',
      accountId: target.accountId,
      sourceType: 'contract',
      sourceId: target.contract.id,
      lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2.5' }],
    }),
  ).rejects.toThrow(/超过合同未入库数量 0/);
  expect(await snapshot(target)).toEqual(before);
  const result = await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  expect(await target.api.exportDocuments({ ids: result.savedIds })).toEqual(input.file);
  expect((await target.api.contractFulfillment({ id: target.contract.id })).rows[0]).toMatchObject({
    received: '10',
    remaining: '0',
  });
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('10');
  const extra = {
    file: await s.api.exportDocuments({ ids: [s.second.id] }),
    requestKey: randomUUID(),
  };
  const rejected = await target.api.importDocumentsPreview(extra);
  expect(rejected.errors.some((e) => /超过/.test(e.message))).toBe(true);
  const after = await snapshot(target, extra.requestKey);
  await expect(
    target.api.importDocuments({ ...extra, confirmation: rejected.confirmation }),
  ).rejects.toThrow(/未保存/);
  expect(await snapshot(target, extra.requestKey)).toEqual(after);
});

const selections = [0, 1, 2, 3].flatMap((a) =>
  [0, 1, 2, 3]
    .filter((b) => b !== a)
    .flatMap((b) =>
      [0, 1, 2, 3].filter((c) => c !== a && c !== b).map((c) => [a, b, c, 6 - a - b - c]),
    ),
);
it.each(selections)(
  'w_ck_rk/w_ck_ck：R1、R2、普通领用、I1按%i/%i/%i/%i选择，不制造负库存且普通操作员可迁入',
  async (...order) => {
    const s = await source();
    const issue = await s.api.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId: s.warehouseId,
      number: 'O',
      date: '2026-01-12',
      category: '领用',
      costAccountId: s.costAccountId,
      lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.5' }],
    });
    const limited = target.a.call(
      server,
      await target.a.addUser('ordinary-importer', {
        permissions: ['inventory.view', 'inventory.import', 'inventory.edit'],
      }),
    );
    const input = {
      file: await s.api.exportDocuments({
        ids: order.map((i) => [s.first.id, s.second.id, issue.id, s.reversal.id][i]!),
      }),
      requestKey: randomUUID(),
    };
    const p = await limited.importDocumentsPreview(input);
    expect(p.errors).toEqual([]);
    expect(p.shortages).toEqual([]);
    const saved = await limited.importDocuments({ ...input, confirmation: p.confirmation });
    expect(await target.api.exportDocuments({ ids: saved.savedIds })).toEqual(input.file);
    expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('0');
    expect(
      (await target.api.contractFulfillment({ id: target.contract.id })).rows[0]?.received,
    ).toBe('10');
  },
);

it('ht1/ht2：反冲历史预览不能写入，作用域结束后相同头行仍按普通合同余额校验', async () => {
  await target.receive('TARGET-FULL');
  const receipt: DocumentInput = {
    requestKey: randomUUID(),
    kind: 'receipt',
    warehouseId: target.warehouseId,
    number: 'HISTORY-R',
    date: '2026-01-10',
    category: '采购',
    accountId: target.accountId,
    sourceType: 'contract',
    sourceId: target.contract.id,
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.5' }],
  };
  const reversal: DocumentInput = {
    requestKey: randomUUID(),
    kind: 'issue',
    warehouseId: target.warehouseId,
    number: 'HISTORY-I',
    date: '2026-01-11',
    category: '其他出库',
    costAccountId: target.costAccountId,
    lines: receipt.lines,
  };
  const before = await snapshot(target);
  await target.a.svcFor('inventory').tx(async (t) => {
    await withContractReversalHistory(t, [{ receipt, reversal }], false, async () => {
      await inventoryService(t).prepare(receipt);
      await expect(inventoryService(t).saveDocument(receipt)).rejects.toThrow(/预览/);
    });
    await expect(inventoryService(t).prepare(receipt)).rejects.toThrow(/超过合同未入库数量 0/);
  });
  expect(await snapshot(target)).toEqual(before);
});

it('ht1/ht2：目标已有9、净零历史加本批有效入库1，普通入库仅占真实剩余1', async () => {
  const s = await source();
  await target.receive('TARGET-NINE', '9');
  await s.api.saveDocument({
    requestKey: randomUUID(),
    id: s.second.id,
    revision: s.second.revision,
    kind: 'receipt',
    warehouseId: s.warehouseId,
    number: s.second.number,
    date: s.second.date,
    category: '采购',
    accountId: s.accountId,
    sourceType: 'contract',
    sourceId: s.contract.id,
    lines: [{ productCode: 'P1', quantity: '1', unitPrice: '2.5' }],
  });
  const input = {
    file: await s.api.exportDocuments({ ids: [s.second.id, s.first.id, s.reversal.id] }),
    requestKey: randomUUID(),
  };
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  const saved = await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  expect(await target.api.exportDocuments({ ids: saved.savedIds })).toEqual(input.file);
  expect((await target.api.contractFulfillment({ id: target.contract.id })).rows[0]).toMatchObject({
    received: '10',
    remaining: '0',
  });
});

it('w_ck_rk/w_ck_ck：相反方向两组反冲有交叉库存依赖时，先退回领用再反冲入库，不制造短缺', async () => {
  const s = await setup();
  const r = await s.receive('R');
  const o = await s.api.saveDocument({
    requestKey: randomUUID(),
    kind: 'issue',
    warehouseId: s.warehouseId,
    number: 'O',
    date: '2026-01-10',
    category: '领用',
    costAccountId: s.costAccountId,
    lines: [{ productCode: 'P1', quantity: '10', unitPrice: '2.5' }],
  });
  const returned = await s.api.reverseDocument({
    id: o.id,
    revision: o.revision,
    requestKey: randomUUID(),
    number: 'RETURNED',
    date: '2026-01-11',
    accountId: s.accountId,
    unitPrices: ['2.5'],
    confirmed: true,
  });
  const reversed = await s.api.reverseDocument({
    id: r.id,
    revision: r.revision,
    requestKey: randomUUID(),
    number: 'REVERSED',
    date: '2026-01-12',
    accountId: s.costAccountId,
    confirmed: true,
  });
  const input = {
    file: await s.api.exportDocuments({ ids: [r.id, reversed.id, o.id, returned.id] }),
    requestKey: randomUUID(),
  };
  const p = await target.api.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  await target.api.importDocuments({ ...input, confirmation: p.confirmation });
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('0');
  expect((await target.api.contractFulfillment({ id: target.contract.id })).rows[0]?.received).toBe(
    '0',
  );
});

it.each(['目标入库变更', '合同取消', '期间关闭'] as const)(
  'ht1/ht2：满额净零历史预览后%s，旧确认拒绝且保留外部结果',
  async (change) => {
    const s = await source();
    const full = await target.receive('TARGET-FULL');
    const input = {
      file: await s.api.exportDocuments({ ids: [s.reversal.id, s.first.id] }),
      requestKey: randomUUID(),
    };
    const p = await target.api.importDocumentsPreview(input);
    expect(p.errors).toEqual([]);
    if (change === '目标入库变更')
      await target.api.saveDocument({
        requestKey: randomUUID(),
        id: full.id,
        revision: full.revision,
        kind: 'receipt',
        warehouseId: target.warehouseId,
        number: full.number,
        date: full.date,
        category: '采购',
        accountId: target.accountId,
        sourceType: 'contract',
        sourceId: target.contract.id,
        lines: [{ productCode: 'P1', quantity: '9', unitPrice: '2.5' }],
      });
    else if (change === '合同取消')
      await target.api.setContractStatus({
        id: target.contract.id,
        revision: target.contract.revision,
        status: 'cancelled',
        confirmed: true,
      });
    else await target.a.svc.periods.setStatus(202601, 'closed');
    const before = await snapshot(target, input.requestKey);
    await expect(
      target.api.importDocuments({ ...input, confirmation: p.confirmation }),
    ).rejects.toThrow(/未保存|预览已过期/);
    expect(await snapshot(target, input.requestKey)).toEqual(before);
  },
);

it.each(['缺关系', '数量不符', '金额伪造'] as const)(
  'ht1/ht2：满额历史对%s不得获得净量额度',
  async (invalid) => {
    const s = await source();
    await target.receive('TARGET-FULL');
    const file = await s.api.exportDocuments({ ids: [s.first.id, s.reversal.id] });
    if (file.version !== 2) throw new Error('缺少关系');
    if (invalid === '缺关系') file.relations.reversals = [];
    else if (invalid === '数量不符') file.documents[1]!.lines[0]!.quantity = '9';
    else file.documents[0]!.lines[0]!.grossCents++;
    const input = { file, requestKey: randomUUID() };
    const p = await target.api.importDocumentsPreview(input);
    expect(p.errors.length).toBeGreaterThan(0);
    const before = await snapshot(target, input.requestKey);
    await expect(
      target.api.importDocuments({ ...input, confirmation: p.confirmation }),
    ).rejects.toThrow(/未保存/);
    expect(await snapshot(target, input.requestKey)).toEqual(before);
  },
);

it.each(['关系写入报错', '关系保存后被移除', '明细保存后被改变'] as const)(
  'ht1/ht2：满额净零历史%s，已有单据和整批头行、关系、版本、日志全部回滚',
  async (failure) => {
    const s = await source();
    await target.receive('TARGET-FULL');
    const input = {
      file: await s.api.exportDocuments({ ids: [s.first.id, s.reversal.id] }),
      requestKey: randomUUID(),
    };
    const p = await target.api.importDocumentsPreview(input);
    expect(p.errors).toEqual([]);
    const before = await snapshot(target, input.requestKey);
    if (failure === '关系写入报错')
      await sql`CREATE TEMP TRIGGER history_fail BEFORE INSERT ON inventory_reversal
    BEGIN SELECT RAISE(ABORT,'历史反冲关系写入失败'); END`.execute(target.a.svc.db);
    else if (failure === '关系保存后被移除')
      await sql`CREATE TEMP TRIGGER history_fail AFTER INSERT ON inventory_reversal
    BEGIN DELETE FROM inventory_reversal WHERE original_document_id=NEW.original_document_id; END`.execute(
        target.a.svc.db,
      );
    else
      await sql`CREATE TEMP TRIGGER history_fail AFTER INSERT ON inventory_reversal
    BEGIN UPDATE inventory_line SET quantity_e6=quantity_e6+1000000 WHERE document_id=NEW.reversal_document_id; END`.execute(
        target.a.svc.db,
      );
    await expect(
      target.api.importDocuments({ ...input, confirmation: p.confirmation }),
    ).rejects.toThrow(/写入失败|未保存|不一致/);
    expect(await snapshot(target, input.requestKey)).toEqual(before);
    await sql`DROP TRIGGER history_fail`.execute(target.a.svc.db);
    const saved = await target.api.importDocuments({ ...input, confirmation: p.confirmation });
    expect(await target.api.exportDocuments({ ids: saved.savedIds })).toEqual(input.file);
  },
);

it('w_ck_ck：真实负库存仍要求权限和明确确认，历史净量不能消除实际短缺', async () => {
  const s = await source();
  const raw = {
    requestKey: randomUUID(),
    kind: 'issue' as const,
    warehouseId: s.warehouseId,
    number: 'O-NEGATIVE',
    date: '2026-01-12',
    category: '领用' as const,
    costAccountId: s.costAccountId,
    lines: [{ productCode: 'P1', quantity: '11', unitPrice: '2.5' }],
  };
  const negative = await s.api.previewDocument(raw);
  const issue = await s.api.saveDocument({ ...raw, negativeConfirmation: negative.confirmation });
  const file = await s.api.exportDocuments({
    ids: [s.first.id, s.second.id, issue.id, s.reversal.id],
  });
  const input = { file, requestKey: randomUUID() };
  const limited = target.a.call(
    server,
    await target.a.addUser('no-negative-importer', {
      permissions: ['inventory.view', 'inventory.import', 'inventory.edit'],
    }),
  );
  const p = await limited.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages.some((r) => r.difference === '1')).toBe(true);
  const before = await snapshot(target, input.requestKey);
  await expect(limited.importDocuments({ ...input, confirmation: p.confirmation })).rejects.toThrow(
    /权限/,
  );
  const admin = await target.api.importDocumentsPreview(input);
  await expect(
    target.api.importDocuments({ ...input, confirmation: admin.confirmation }),
  ).rejects.toThrow(/尚未明确确认/);
  expect(await snapshot(target, input.requestKey)).toEqual(before);
  const allowed = { ...input, allowNegative: true };
  const confirmed = await target.api.importDocumentsPreview(allowed);
  await target.api.importDocuments({ ...allowed, confirmation: confirmed.confirmation });
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('-1');
});

it('w_ck_ck：两条领用退回来源链需要不同周转库存时，回溯选择合法次序，不因贪心次序制造短缺', async () => {
  const s = await setup();
  for (const fixture of [s, target])
    await fixture.api.saveOpening({
      warehouseId: fixture.warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity: '3', unitPrice: '2.5' }],
    });
  const issue = (number: string, quantity: string, sourceId?: number) =>
    s.api.saveDocument({
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId: s.warehouseId,
      number,
      date: '2026-01-10',
      category: '领用',
      costAccountId: s.costAccountId,
      sourceType: sourceId == null ? null : 'document',
      sourceId,
      lines: [{ productCode: 'P1', quantity, unitPrice: '2.5' }],
    });
  const b0 = await issue('B0', '1'),
    b1 = await issue('B1', '2', b0.id);
  const br = await s.api.reverseDocument({
    id: b1.id,
    revision: b1.revision,
    requestKey: randomUUID(),
    number: 'BR',
    date: '2026-01-11',
    accountId: s.accountId,
    unitPrices: ['2.5'],
    confirmed: true,
  });
  const a0 = await issue('A0', '1'),
    a1 = await issue('A1', '1', a0.id);
  const ar = await s.api.reverseDocument({
    id: a1.id,
    revision: a1.revision,
    requestKey: randomUUID(),
    number: 'AR',
    date: '2026-01-11',
    accountId: s.accountId,
    unitPrices: ['2.5'],
    confirmed: true,
  });
  const input = {
    file: await s.api.exportDocuments({ ids: [a0.id, a1.id, ar.id, b0.id, b1.id, br.id] }),
    requestKey: randomUUID(),
  };
  const limited = target.a.call(
    server,
    await target.a.addUser('loan-chain-importer', {
      permissions: ['inventory.view', 'inventory.import', 'inventory.edit'],
    }),
  );
  const p = await limited.importDocumentsPreview(input);
  expect(p.errors).toEqual([]);
  expect(p.shortages).toEqual([]);
  const result = await limited.importDocuments({ ...input, confirmation: p.confirmation });
  expect(result.savedIds).toHaveLength(6);
  expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('1');
});

it.each([true, false])(
  'w_ck_ck：真实52单净零历史，大额领用需要2=%s，预检有界返回且普通合法多链可导入',
  async (needsTwo) => {
    const s = await setup();
    await s.api.saveOpening({
      warehouseId: s.warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity: '2', unitPrice: '2.5' }],
    });
    await target.api.saveOpening({
      warehouseId: target.warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity: '1', unitPrice: '2.5' }],
    });
    const ids: number[] = [];
    for (let i = 0; i < 26; i++) {
      const quantity = i === 25 && needsTwo ? '2' : '1';
      const issued = await s.api.saveDocument({
        requestKey: randomUUID(),
        kind: 'issue',
        warehouseId: s.warehouseId,
        number: `LOAN-${i}`,
        date: '2026-01-10',
        category: '领用',
        costAccountId: s.costAccountId,
        lines: [{ productCode: 'P1', quantity, unitPrice: '2.5' }],
      });
      const returned = await s.api.reverseDocument({
        id: issued.id,
        revision: issued.revision,
        requestKey: randomUUID(),
        number: `RETURN-${i}`,
        date: '2026-01-11',
        accountId: s.accountId,
        unitPrices: ['2.5'],
        confirmed: true,
      });
      ids.push(issued.id, returned.id);
    }
    const file = await s.api.exportDocuments({ ids });
    expect(file.documents).toHaveLength(52);
    expect(file.documents.reduce((n, d) => n + d.lines.length, 0)).toBe(52);
    const input = {
      file: JSON.parse(JSON.stringify(file)) as ExchangeFile,
      requestKey: randomUUID(),
    };
    const limited = target.a.call(
      server,
      await target.a.addUser('bounded-importer', {
        permissions: ['inventory.view', 'inventory.import', 'inventory.edit'],
      }),
    );
    const before = await snapshot(target, input.requestKey);
    const start = performance.now();
    const p = await limited.importDocumentsPreview(input);
    const ms = performance.now() - start;
    console.log(JSON.stringify({ fixture: '52单52行净零历史', needsTwo, previewMs: ms }));
    expect(ms).toBeLessThan(2000);
    expect(p.errors).toEqual([]);
    expect(await snapshot(target, input.requestKey)).toEqual(before);
    if (needsTwo) {
      expect(p.shortages).toMatchObject([
        { number: 'LOAN-25', current: '1', requested: '2', difference: '1' },
      ]);
      await expect(
        limited.importDocuments({ ...input, confirmation: p.confirmation }),
      ).rejects.toThrow(/权限/);
      expect(await snapshot(target, input.requestKey)).toEqual(before);
    } else {
      expect(p.shortages).toEqual([]);
      const saved = await limited.importDocuments({ ...input, confirmation: p.confirmation });
      expect(saved.savedIds).toHaveLength(52);
      expect((await target.api.stock({ warehouseId: target.warehouseId }))[0]?.balance).toBe('1');
    }
  },
);
