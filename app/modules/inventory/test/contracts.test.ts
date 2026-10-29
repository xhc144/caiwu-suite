import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { ContractInput, DocumentInput } from '../shared';
import { inventoryService } from '../server/service';

let app: TestApp;
const caller = (a: TestApp) => a.call(server);
let api: ReturnType<typeof caller>;
let warehouseId: number, cash: number, cost: number, supplierId: number;
const contract = (number = 'HT1'): ContractInput => ({
  number,
  warehouseId,
  supplierId,
  date: '2026-01-05',
  lines: [
    { productCode: 'P1', quantity: '4', unitPrice: '2' },
    { productCode: 'P1', quantity: '6', unitPrice: '3' },
  ],
});
const receive = async (id: number, number: string, quantity: string) => {
  const draft = await api.contractDraft({ id });
  return api.saveDocument({
    ...draft,
    number,
    accountId: cash,
    lines: [{ productCode: 'P1', quantity, unitPrice: '2.5' }],
  });
};
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '合成采购仓' });
  await api.saveProduct({ code: 'P1', name: '采购产品' });
  await api.saveProduct({ code: 'P2', name: '合同外产品' });
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
  supplierId = (await app.svc.dimensions.getByCode('partner', 'S001'))!.id;
});
afterEach(async () => app.close());
it('ht1/ht2：同产品计划累计数量超出可核算范围时保存拒绝，不留下无法履约的合同', async () => {
  await expect(
    api.saveContract({
      ...contract('OVERFLOW'),
      lines: Array.from({ length: 10 }, () => ({
        productCode: 'P1',
        quantity: '999999999',
        unitPrice: '0',
      })),
    }),
  ).rejects.toThrow(/数量.*范围/);
  expect(await api.contracts({})).toEqual([]);
});

it('ht1/ht2/w_cb_ck_copy：分批入库汇总重复产品，草稿仅带余额，修改扣回本单，超量整单回滚', async () => {
  const c = await api.saveContract(contract());
  const r = await receive(c.id, 'R1', '6');
  expect((await api.contractFulfillment({ id: c.id })).rows).toEqual([
    { productCode: 'P1', productName: '采购产品', planned: '10', received: '6', remaining: '4' },
  ]);
  expect((await api.contractDraft({ id: c.id })).lines).toMatchObject([
    { productCode: 'P1', quantity: '4', unitPrice: '3' },
  ]);
  await api.saveDocument({
    requestKey: randomUUID(),
    id: r.id,
    revision: r.revision,
    kind: 'receipt',
    warehouseId,
    number: 'R1',
    date: r.date,
    category: '采购',
    accountId: cash,
    sourceType: 'contract',
    sourceId: c.id,
    lines: [{ productCode: 'P1', quantity: '5', unitPrice: '2.5' }],
  });
  await expect(receive(c.id, 'TOO-MUCH', '6')).rejects.toThrow(/超过合同未入库数量 5/);
  expect(await api.documents({})).toHaveLength(1);
  const result = await receive(c.id, 'R2', '5');
  expect((await api.contractFulfillment({ id: c.id })).rows[0]).toMatchObject({
    received: '10',
    remaining: '0',
  });
  await expect(api.contractDraft({ id: c.id })).rejects.toThrow(/全部入库/);
  await api.removeDocument({ id: result.id, revision: result.revision, confirmed: true });
  expect((await api.contractDraft({ id: c.id })).lines[0]?.quantity).toBe('5');
});

it('ht1/ht2/w_ck_rk：日期、合同外产品、合并多行超量及并发末批入库均在事务内复核', async () => {
  const c = await api.saveContract(contract());
  const draft: DocumentInput = {
    ...(await api.contractDraft({ id: c.id })),
    number: 'R1',
    accountId: cash,
  };
  await expect(api.saveDocument({ ...draft, date: '2026-01-04' })).rejects.toThrow(/不能早于/);
  await expect(
    api.saveDocument({ ...draft, lines: [{ productCode: 'P2', quantity: '1', unitPrice: '1' }] }),
  ).rejects.toThrow(/不在来源采购合同/);
  await expect(
    api.saveDocument({
      ...draft,
      lines: [
        { productCode: 'P1', quantity: '6', unitPrice: '1' },
        { productCode: 'P1', quantity: '5', unitPrice: '1' },
      ],
    }),
  ).rejects.toThrow(/超过/);
  const results = await Promise.allSettled([receive(c.id, 'R1', '6'), receive(c.id, 'R2', '6')]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await api.contractFulfillment({ id: c.id })).rows[0]?.received).toBe('6');
});

it('w_cb_ck_copy/w_ck_rk：反冲恢复合同余额，删除反冲恢复履约，删除来源入库再次恢复余额', async () => {
  const c = await api.saveContract(contract());
  const r = await receive(c.id, 'R1', '5');
  const reversed = await api.reverseDocument({
    id: r.id,
    revision: r.revision,
    requestKey: randomUUID(),
    number: 'R1-FC',
    date: '2026-01-10',
    accountId: cost,
    confirmed: true,
  });
  const f = await api.contractFulfillment({ id: c.id });
  expect(f.rows[0]).toMatchObject({ received: '0', remaining: '10' });
  expect(f.documents[0]?.reversed).toBe(true);
  expect((await api.contractDraft({ id: c.id })).lines.map((l) => l.quantity)).toEqual(['4', '6']);
  await api.removeDocument({ id: reversed.id, revision: reversed.revision, confirmed: true });
  expect((await api.contractFulfillment({ id: c.id })).rows[0]?.received).toBe('5');
  const fresh = await api.document({ id: r.id });
  await api.removeDocument({ id: fresh.id, revision: fresh.revision, confirmed: true });
  expect((await api.contractFulfillment({ id: c.id })).rows[0]?.received).toBe('0');
});

it('ht1/ht2：合同状态、确认、版本、权限及引用删除保护，取消可恢复执行', async () => {
  const c = await api.saveContract(contract());
  await expect(
    api.setContractStatus({ id: c.id, revision: c.revision, status: 'completed', confirmed: true }),
  ).rejects.toThrow(/尚有未入库/);
  await expect(
    api.removeContract({ id: c.id, revision: c.revision, confirmed: false }),
  ).rejects.toThrow(/确认/);
  const cancelled = await api.setContractStatus({
    id: c.id,
    revision: c.revision,
    status: 'cancelled',
    confirmed: true,
  });
  await expect(api.contractDraft({ id: c.id })).rejects.toThrow(/取消/);
  await expect(
    api.setContractStatus({ id: c.id, revision: c.revision, status: 'open', confirmed: true }),
  ).rejects.toThrow(/修改|版本/);
  await api.setContractStatus({
    id: c.id,
    revision: cancelled.revision,
    status: 'open',
    confirmed: true,
  });
  await receive(c.id, 'R1', '10');
  const fresh = await api.contract({ id: c.id });
  await api.setContractStatus({
    id: c.id,
    revision: fresh.revision,
    status: 'completed',
    confirmed: true,
  });
  await expect(
    api.removeContract({ id: c.id, revision: fresh.revision + 1, confirmed: true }),
  ).rejects.toThrow(/已有来源入库/);
  const unused = await api.saveContract(contract('UNUSED'));
  await api.removeContract({ id: unused.id, revision: unused.revision, confirmed: true });
  await expect(api.contract({ id: unused.id })).rejects.toThrow(/不存在/);
  const token = await app.addUser('viewer', { permissions: ['inventory.view'] });
  await expect(
    app
      .call(server, token)
      .removeContract({ id: c.id, revision: fresh.revision + 1, confirmed: true }),
  ).rejects.toThrow(/权限/);
});

it('w_cb_ckxz：仓库删除要求确认与最新版本，合同、期初、单据及盘点引用均禁止删除', async () => {
  const empty = await api.saveWarehouse({ code: 'EMPTY', name: '未使用仓' });
  await expect(api.removeWarehouse({ id: empty, revision: 1, confirmed: false })).rejects.toThrow(
    /确认/,
  );
  await api.saveWarehouse({ id: empty, revision: 1, code: 'EMPTY', name: '新名称' });
  await expect(api.removeWarehouse({ id: empty, revision: 1, confirmed: true })).rejects.toThrow(
    /版本|修改/,
  );
  await api.removeWarehouse({ id: empty, revision: 2, confirmed: true });
  expect((await api.warehouses()).some((w) => w.id === empty)).toBe(false);
  const c = await api.saveContract(contract());
  await expect(
    api.removeWarehouse({ id: warehouseId, revision: 1, confirmed: true }),
  ).rejects.toThrow(/已有/);
  await api.removeContract({ id: c.id, revision: c.revision, confirmed: true });
  await api.saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '0', unitPrice: '0' }],
  });
  await expect(
    api.removeWarehouse({ id: warehouseId, revision: 1, confirmed: true }),
  ).rejects.toThrow(/已有/);
});

it('w_ck_rk/w_ck_ck：复制引用阻止删除来源，清理复制单后可删除；自身来源拒绝', async () => {
  const c = await api.saveContract(contract());
  const r = await receive(c.id, 'R1', '1');
  const sourceDraft = await api.copyDocument({ id: r.id });
  await expect(
    api.saveDocument({
      ...sourceDraft,
      id: r.id,
      revision: r.revision,
      number: 'R1',
      sourceType: null,
      sourceId: null,
    }),
  ).rejects.toThrow(/来源关联不能/);
  const copied = await api.saveDocument({
    ...(await api.copyDocument({ id: r.id })),
    number: 'COPY',
  });
  await expect(
    api.removeDocument({ id: r.id, revision: r.revision, confirmed: true }),
  ).rejects.toThrow(/引用/);
  await expect(
    api.saveDocument({
      ...(await api.copyDocument({ id: copied.id })),
      id: copied.id,
      revision: copied.revision,
      number: 'COPY',
      sourceId: copied.id,
    }),
  ).rejects.toThrow(/自身/);
  await api.removeDocument({ id: copied.id, revision: copied.revision, confirmed: true });
  await api.removeDocument({ id: r.id, revision: r.revision, confirmed: true });
  expect(await api.documents({})).toEqual([]);
  expect(
    (await inventoryService(app.svcFor('inventory')).contractFulfillment(c.id)).rows[0]?.received,
  ).toBe('0');
});
