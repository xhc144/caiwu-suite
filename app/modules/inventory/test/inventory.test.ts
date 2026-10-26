import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTestApp, type TestApp, seedVouchers } from '@caiwu/testkit';
import { Decimal } from '@caiwu/core';
import type { DocumentInput, ProductInput } from '../shared';
import server from '../server';
import { inventoryService, priceLine, e6, quantity } from '../server/service';
import type { InventoryTables } from '../server/migrations';
let app: TestApp;
const caller = (a: TestApp, token?: string) => a.call(server, token);
let api: ReturnType<typeof caller>;
let warehouseId: number, cash: number, cost: number;
const product = (code = 'P1'): ProductInput => ({
  code,
  name: `产品${code}`,
  unit: '件',
  receiptPrice: '2.55',
  issuePrice: '5.66',
  planPrice: '3',
  allocationFactor: '1',
});
const input = (kind: 'receipt' | 'issue', n: string, qty = '5'): DocumentInput => ({
  requestKey: randomUUID(),
  kind,
  number: n,
  warehouseId,
  date: '2026-01-10',
  category: kind === 'receipt' ? '采购' : '销售',
  accountId: cash,
  costAccountId: kind === 'issue' ? cost : null,
  taxRate: '13',
  lines: [{ productCode: 'P1', quantity: qty, unitPrice: '3.33', note: '原单说明' }],
});
async function balance() {
  return (await api.stock({ warehouseId, productCode: 'P1' }))[0]!.balance;
}
async function opening(n = '10') {
  return api.saveOpening({
    warehouseId,
    revision: (await api.opening({ warehouseId })).revision,
    rows: [{ productCode: 'P1', quantity: n, unitPrice: '2.55' }],
  });
}
beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'chengben' });
  api = caller(app);
  warehouseId = await api.saveWarehouse({ code: '01', name: '原料仓' });
  await api.saveProduct(product());
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
});
afterEach(async () => {
  await app.close();
});
describe('A 闭环与数量事务', () => {
  it('w_cb_qc → w_ck_rk1 → w_ck_ck1 → w_ck_kc/w_ck_tz1 → w_cb_pdk_1：10+5−3=12，实盘11差异−1', async () => {
    await opening();
    await api.saveDocument(input('receipt', 'R1', '5'));
    await api.saveDocument(input('issue', 'S1', '3'));
    expect(await balance()).toBe('12');
    const ledger = await api.ledger({ warehouseId, productCode: 'P1' });
    expect(ledger.map((r) => r.balance)).toEqual(['10', '15', '12']);
    const count = await api.generateCount({
      warehouseId,
      period: 202601,
      revision: 0,
      confirmed: false,
    });
    expect(count.rows[0]!.book).toBe('12');
    await api.saveCount({
      warehouseId,
      period: 202601,
      revision: count.revision,
      rows: [{ productCode: 'P1', actual: '11', note: '少1' }],
    });
    const reopen = await api.count({ warehouseId, period: 202601 });
    expect(reopen.rows[0]).toMatchObject({
      book: '12',
      actual: '11',
      difference: '-1',
      note: '少1',
    });
    expect(await balance()).toBe('12');
  });
  it('w_ck_ck1：同产品多行合并校验，修改扣回原单，删除恢复', async () => {
    await opening();
    const d = await api.saveDocument({
      ...input('issue', 'S1', '3'),
      lines: [
        { productCode: 'P1', quantity: '2', unitPrice: '1' },
        { productCode: 'P1', quantity: '3', unitPrice: '1' },
      ],
    });
    expect(await balance()).toBe('5');
    await api.saveDocument({ ...input('issue', 'S1', '9'), id: d.id, revision: d.revision });
    expect(await balance()).toBe('1');
    const v = await api.document({ id: d.id });
    await api.removeDocument({ id: d.id, revision: v.revision, confirmed: true });
    expect(await balance()).toBe('10');
    const tooMany = {
      ...input('issue', 'S2'),
      lines: [
        { productCode: 'P1', quantity: '6', unitPrice: '1' },
        { productCode: 'P1', quantity: '6', unitPrice: '1' },
      ],
    };
    expect((await api.previewDocument(tooMany)).shortages[0]).toMatchObject({
      current: '10',
      requested: '12',
      difference: '2',
    });
    await expect(api.saveDocument(tooMany)).rejects.toThrow(/尚未确认/);
    expect(await balance()).toBe('10');
  });
  it('w_ck_ck1：重复点击幂等，并发保存与并发超量出库只记一次', async () => {
    await opening();
    const v = input('issue', 'S1', '7');
    const [a, b] = await Promise.all([api.saveDocument(v), api.saveDocument(v)]);
    expect(a.id).toBe(b.id);
    expect(await balance()).toBe('3');
    expect(await api.documents({})).toHaveLength(1);
    await expect(
      api.saveDocument({ ...v, lines: [{ productCode: 'P1', quantity: '1', unitPrice: '1' }] }),
    ).rejects.toThrow(/不同内容/);
    const results = await Promise.allSettled([
      api.saveDocument(input('issue', 'S2', '2')),
      api.saveDocument(input('issue', 'S3', '2')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toBe('1');
  });
  it('w_ck_ck1：负库存必须独立权限与当前版本确认，日志保留，取消不记账', async () => {
    await opening('2');
    const v = input('issue', 'S1', '3');
    const p = await api.previewDocument(v);
    expect(p.shortages).toEqual([
      { productCode: 'P1', productName: '产品P1', current: '2', requested: '3', difference: '1' },
    ]);
    expect(await balance()).toBe('2');
    const clerk = caller(
      app,
      await app.addUser('clerk', { permissions: ['inventory.edit', 'inventory.view'] }),
    );
    await expect(
      clerk.saveDocument({ ...v, negativeConfirmation: p.confirmation }),
    ).rejects.toThrow(/权限/);
    await api.saveProduct(product('P2'));
    await expect(api.saveDocument({ ...v, negativeConfirmation: p.confirmation })).rejects.toThrow(
      /版本已变化/,
    );
    const fresh = await api.previewDocument(v);
    await api.saveDocument({ ...v, negativeConfirmation: fresh.confirmation });
    expect(await balance()).toBe('-1');
    expect((await app.svc.log.list()).some((l) => l.action === 'inventory.negative-stock')).toBe(
      true,
    );
  });
  it('w_ck_rk1/w_cb_qc：减少已用入库或期初不能静默产生负库存；逆操作原子化', async () => {
    await opening('2');
    const r = await api.saveDocument(input('receipt', 'R1', '5'));
    await api.saveDocument(input('issue', 'S1', '6'));
    expect(await balance()).toBe('1');
    await expect(
      api.removeDocument({ id: r.id, revision: r.revision, confirmed: true }),
    ).rejects.toThrow(/负库存/);
    await expect(
      api.saveDocument({ ...input('receipt', 'R1', '1'), id: r.id, revision: r.revision }),
    ).rejects.toThrow(/负库存/);
    await expect(
      api.saveOpening({ warehouseId, revision: 1, confirmReplace: true, rows: [] }),
    ).rejects.toThrow(/负库存/);
    expect(await balance()).toBe('1');
    expect((await api.document({ id: r.id })).lines[0]!.quantity).toBe('5');
  });
});
describe('原版阻止规则与确认规则', () => {
  it('w_cb_cpda_xg：空/重复产品编号拒绝，改号稳定 ID，已发生存货科目不能变更', async () => {
    const p = (await api.products({}))[0]!;
    await expect(api.saveProduct({ ...p, code: '' })).rejects.toThrow();
    await api.saveProduct(product('P2'));
    await expect(api.saveProduct({ ...p, code: 'P2' })).rejects.toThrow(/重复/);
    await opening();
    await expect(api.saveProduct({ ...p, inventoryAccountId: cash })).rejects.toThrow(
      /不能变更存货科目/,
    );
    const changed = await api.saveProduct({ ...p, code: 'NEW' });
    expect(changed.id).toBe(p.id);
    expect((await api.opening({ warehouseId })).rows[0]!.productCode).toBe('NEW');
  });
  it('w_cb_cpda：非末级或停用科目拒绝，零系数需要确认使用1', async () => {
    const parent = (await app.svc.accounts.require('1002')).id;
    await expect(api.saveProduct({ ...product('P2'), inventoryAccountId: parent })).rejects.toThrow(
      /末级/,
    );
    await app.svc.db.updateTable('account').set({ disabled: 1 }).where('id', '=', cash).execute();
    await expect(api.saveProduct({ ...product('P2'), salesAccountId: cash })).rejects.toThrow(
      /启用/,
    );
    await expect(api.saveProduct({ ...product('P2'), allocationFactor: '0' })).rejects.toThrow(
      /系数为零/,
    );
    expect(
      (await api.saveProduct({ ...product('P2'), allocationFactor: '0', confirmZeroFactor: true }))
        .allocationFactor,
    ).toBe('1');
  });
  it('w_cb_cpda：删除前明确集合两次确认，已用于期初/单据/盘点/合同产品不能删', async () => {
    const p = await api.saveProduct(product('P2'));
    await expect(
      api.removeProducts({
        products: [{ id: p.id, revision: 1 }],
        confirmSet: true,
        confirmDelete: false,
      }),
    ).rejects.toThrow(/确认/);
    await api.removeProducts({
      products: [{ id: p.id, revision: 1 }],
      confirmSet: true,
      confirmDelete: true,
    });
    expect(await api.products({ keyword: 'P2' })).toEqual([]);
    await opening();
    const p1 = (await api.products({}))[0]!;
    await expect(
      api.removeProducts({ products: [p1], confirmSet: true, confirmDelete: true }),
    ).rejects.toThrow(/已使用/);
  });
  it('w_cb_qc：未知/重复产品与非法数字拒绝，全部保存回滚，已有期初需确认覆盖', async () => {
    await expect(
      api.saveOpening({
        warehouseId,
        revision: 0,
        rows: [{ productCode: '未知', quantity: '1', unitPrice: '1' }],
      }),
    ).rejects.toThrow(/第 1 行/);
    await expect(
      api.saveOpening({
        warehouseId,
        revision: 0,
        rows: [{ productCode: 'P1', quantity: 'bad', unitPrice: '1' }],
      }),
    ).rejects.toThrow();
    await expect(
      api.saveOpening({
        warehouseId,
        revision: 0,
        rows: [
          { productCode: 'P1', quantity: '1', unitPrice: '1' },
          { productCode: 'P1', quantity: '2', unitPrice: '1' },
        ],
      }),
    ).rejects.toThrow(/重复/);
    expect((await api.opening({ warehouseId })).rows).toHaveLength(0);
    await opening();
    await expect(api.saveOpening({ warehouseId, revision: 1, rows: [] })).rejects.toThrow(
      /已存在期初/,
    );
    await api.saveOpening({ warehouseId, revision: 1, confirmReplace: true, rows: [] });
    expect((await api.opening({ warehouseId })).rows).toHaveLength(0);
  });
  it('w_cb_qc：超过期初阶段或已成本核算时禁止修改，显示核算截止月', async () => {
    await opening();
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(opening('12')).rejects.toThrow(/结账/);
    await app.svc.periods.setStatus(202601, 'open');
    await app.svc.db
      .withTables<InventoryTables>()
      .updateTable('inventory_control')
      .set({ cost_period: 202601, cost_cutoff_date: '2026-01-31' })
      .where('id', '=', 1)
      .execute();
    await expect(opening('12')).rejects.toThrow(/核算截止月：202601/);
    expect(await balance()).toBe('10');
  });
  it('w_ck_rk1/w_ck_ck1：空/重复单号、未知/空产品、无内容不删旧单、收付款和成本科目要求', async () => {
    const v = input('receipt', 'R1');
    const d = await api.saveDocument(v);
    await expect(api.saveDocument({ ...v, requestKey: randomUUID() })).rejects.toThrow(/重复/);
    await expect(
      api.saveDocument({ ...v, requestKey: randomUUID(), number: '' }),
    ).rejects.toThrow();
    await expect(
      api.saveDocument({
        ...input('receipt', 'R2'),
        lines: [{ productCode: '未知', quantity: '1', unitPrice: '1' }],
      }),
    ).rejects.toThrow(/第 1 行/);
    await expect(
      api.saveDocument({
        ...input('receipt', 'R2'),
        lines: [{ productCode: '', quantity: '1', unitPrice: '1' }],
      }),
    ).rejects.toThrow();
    await expect(api.saveDocument({ ...input('receipt', 'R2'), accountId: null })).rejects.toThrow(
      /付款科目/,
    );
    await expect(
      api.saveDocument({ ...input('issue', 'S1'), costAccountId: null }),
    ).rejects.toThrow(/成本科目/);
    await expect(api.saveDocument({ ...input('issue', 'S1'), accountId: null })).rejects.toThrow(
      /收款科目/,
    );
    await expect(
      api.saveDocument({ ...input('receipt', 'R1'), id: d.id, revision: d.revision, lines: [] }),
    ).rejects.toThrow(/未删除原单/);
    expect((await api.document({ id: d.id })).lines).toHaveLength(1);
  });
  it('w_ck_rk/w_ck_ck：已审核不能改删；取消审核限原人或授权管理员；复制不继承锁态', async () => {
    const d = await api.saveDocument(input('receipt', 'R1'));
    const u = caller(
      app,
      await app.addUser('auditor', { permissions: ['inventory.audit', 'inventory.view'] }),
    );
    const audited = await u.audit({ id: d.id, revision: 1, to: true });
    await expect(api.removeDocument({ id: d.id, revision: 2, confirmed: true })).rejects.toThrow(
      /已审核/,
    );
    await expect(
      api.saveDocument({ ...input('receipt', 'R1'), id: d.id, revision: 2 }),
    ).rejects.toThrow(/已审核/);
    const other = caller(app, await app.addUser('other', { permissions: ['inventory.audit'] }));
    await expect(other.audit({ id: d.id, revision: 2, to: false })).rejects.toThrow(/权限/);
    const copied = await api.copyDocument({ id: d.id });
    expect(copied).not.toHaveProperty('id');
    expect(copied).not.toHaveProperty('audited_by');
    const c = await api.saveDocument({ ...copied, number: 'R2' });
    expect(c).toMatchObject({
      audited_by: null,
      voucher_id: null,
      calculation_status: 'uncalculated',
      revision: 1,
    });
    expect((await api.document({ id: d.id })).audited_by).toBe(audited.audited_by);
    await u.audit({ id: d.id, revision: 2, to: false });
    expect((await api.document({ id: d.id })).audited_by).toBeNull();
  });
  it('w_ck_rk1/w_ck_ck1：期间/原日期/核算截止/已凭证与已核算锁不能绕过', async () => {
    const d = await api.saveDocument(input('receipt', 'R1'));
    await app.svc.periods.setStatus(202601, 'closed');
    await expect(
      api.saveDocument({ ...input('receipt', 'R1'), date: '2026-02-10', id: d.id, revision: 1 }),
    ).rejects.toThrow(/结账/);
    await expect(api.removeDocument({ id: d.id, revision: 1, confirmed: true })).rejects.toThrow(
      /结账/,
    );
    await app.svc.periods.setStatus(202601, 'open');
    const db = app.svc.db.withTables<InventoryTables>();
    await db
      .updateTable('inventory_control')
      .set({ cost_cutoff_date: '2026-01-10' })
      .where('id', '=', 1)
      .execute();
    await expect(
      api.previewDocument({ ...input('receipt', 'R1'), id: d.id, revision: 1 }),
    ).rejects.toThrow(/截止点/);
    await db
      .updateTable('inventory_control')
      .set({ cost_cutoff_date: null })
      .where('id', '=', 1)
      .execute();
    await db
      .updateTable('inventory_document')
      .set({ calculation_status: 'calculated' })
      .where('id', '=', d.id)
      .execute();
    await expect(api.audit({ id: d.id, revision: 1, to: true })).rejects.toThrow(/已核算/);
    await expect(api.removeDocument({ id: d.id, revision: 1, confirmed: true })).rejects.toThrow(
      /已核算/,
    );
    const vs = await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    await db
      .updateTable('inventory_document')
      .set({ calculation_status: 'uncalculated', voucher_id: vs[0]!.id })
      .where('id', '=', d.id)
      .execute();
    await expect(api.audit({ id: d.id, revision: 1, to: false })).rejects.toThrow(/会计凭证/);
    await expect(api.removeDocument({ id: d.id, revision: 1, confirmed: true })).rejects.toThrow(
      /会计凭证/,
    );
  });
  it('w_cb_ck_copy：复制目标重复拒绝、复制原单不变、来源不存在提示', async () => {
    const d = await api.saveDocument(input('receipt', 'R1'));
    const copy = await api.copyDocument({ id: d.id });
    await expect(api.saveDocument({ ...copy, number: 'R1' })).rejects.toThrow(/重复/);
    await api.saveDocument({ ...copy, number: 'R2' });
    expect((await api.document({ id: d.id })).revision).toBe(1);
    await expect(api.document({ id: 9999 })).rejects.toThrow(/已不存在/);
  });
  it('w_ck_tz/w_ck_tz00/w_ck_cx_rkd/w_ck_cx_ckd/w_ck_xsmxz：截止日期与筛选类型不合法拒绝，不忽略条件', async () => {
    for (const name of ['documents', 'stock', 'sales', 'ledger'] as const)
      await expect(
        api[name]({ warehouseId, productCode: 'P1', from: '2026-02-01', to: '2026-01-01' }),
      ).rejects.toThrow(/截止日期/);
    await expect(api.documents({ warehouseId: Number.NaN })).rejects.toThrow();
    await expect(api.documents({ from: '2026-99-99' })).rejects.toThrow();
    expect(await api.documents({})).toEqual([]);
    expect(await api.sales({})).toEqual([]);
  });
  it('w_cb_pdk/w_cb_pdk_1：启用前/超业务月拒绝、未知/重复实盘回滚、重生成/清差/删除需确认', async () => {
    await opening();
    await expect(
      api.generateCount({ warehouseId, period: 202512, revision: 0, confirmed: false }),
    ).rejects.toThrow();
    await expect(
      api.generateCount({ warehouseId, period: 202602, revision: 0, confirmed: false }),
    ).rejects.toThrow(/盘点月份/);
    let c = await api.generateCount({ warehouseId, period: 202601, revision: 0, confirmed: false });
    await api.saveCount({
      warehouseId,
      period: 202601,
      revision: c.revision,
      rows: [{ productCode: 'P1', actual: '11' }],
    });
    c = await api.count({ warehouseId, period: 202601 });
    await expect(
      api.generateCount({ warehouseId, period: 202601, revision: c.revision, confirmed: false }),
    ).rejects.toThrow(/替换/);
    await expect(
      api.resetCount({ warehouseId, period: 202601, revision: c.revision, confirmed: false }),
    ).rejects.toThrow(/预览/);
    await expect(
      api.removeCount({ warehouseId, period: 202601, revision: c.revision, confirmed: false }),
    ).rejects.toThrow(/确认/);
    await expect(
      api.saveCount({
        warehouseId,
        period: 202601,
        revision: c.revision,
        rows: [{ productCode: '未知', actual: '1' }],
      }),
    ).rejects.toThrow(/不存在/);
    await expect(
      api.saveCount({
        warehouseId,
        period: 202601,
        revision: c.revision,
        rows: [
          { productCode: 'P1', actual: '1' },
          { productCode: 'P1', actual: '2' },
        ],
      }),
    ).rejects.toThrow();
    expect((await api.count({ warehouseId, period: 202601 })).rows[0]!.actual).toBe('11');
    await api.resetCount({ warehouseId, period: 202601, revision: c.revision, confirmed: true });
    c = await api.count({ warehouseId, period: 202601 });
    expect(c.rows[0]!.difference).toBe('0');
    expect(await balance()).toBe('10');
    await api.removeCount({ warehouseId, period: 202601, revision: c.revision, confirmed: true });
    expect((await api.count({ warehouseId, period: 202601 })).id).toBeNull();
  });
  it('w_cb_tyzs：先明确集合，数字/日期型白名单与锁字段拒绝，预览不落库', async () => {
    const p = (await api.products({}))[0]!;
    await expect(api.bulk({ products: [], field: 'receiptPrice', value: '1' })).rejects.toThrow();
    await expect(
      api.bulk({ products: [p], field: 'receiptPrice', value: 'bad' }),
    ).rejects.toThrow();
    const preview = await api.bulk({ products: [p], field: 'receiptPrice', value: '9.99' });
    expect(preview[0]!.after.receiptPrice).toBe('9.99');
    expect((await api.products({}))[0]!.receiptPrice).toBe('2.55');
    await api.bulk({ products: [p], field: 'receiptPrice', value: '9.99', confirmed: true });
    expect((await api.products({}))[0]!.receiptPrice).toBe('9.99');
  });
});
describe('B 导入、合同、权限及隔离', () => {
  it('f_rkd_get/f_ckd_get/w_cb_qc：导入逐行预览不保存；覆盖需确认，审核及期间锁复核，失败事务回滚', async () => {
    const payload = {
      kind: 'products' as const,
      rows: [
        { code: 'P2', name: '产品2' },
        { code: 'P3', name: '产品3' },
      ],
    };
    const p = await api.importPreview(payload);
    expect(p.errors).toEqual([]);
    expect(await api.products({})).toHaveLength(1);
    await api.importSave({ ...payload, confirmation: p.confirmation });
    expect(await api.products({})).toHaveLength(3);
    const bad = {
      kind: 'products' as const,
      rows: [
        { code: 'P4', name: '产品4' },
        { code: 'P5', name: '产品5', inventoryAccountId: 9999 },
      ],
    };
    const b = await api.importPreview(bad);
    expect(b.errors[0]!.row).toBe(3);
    await expect(api.importSave({ ...bad, confirmation: b.confirmation })).rejects.toThrow(
      /逐行错误/,
    );
    expect(await api.products({ keyword: 'P4' })).toEqual([]);
    const existing = { kind: 'products' as const, rows: [{ code: 'P1', name: '新名' }] };
    expect((await api.importPreview(existing)).errors).toHaveLength(1);
    const over = await api.importPreview({ ...existing, overwrite: true });
    await api.saveProduct(product('P6'));
    await expect(
      api.importSave({ ...existing, overwrite: true, confirmation: over.confirmation }),
    ).rejects.toThrow(/版本/);
    const d = await api.saveDocument(input('receipt', 'R1'));
    const v = {
      kind: 'document' as const,
      overwrite: true,
      rows: [{ productCode: 'P1', quantity: '1', unitPrice: '1' }],
      document: { ...input('receipt', 'R1'), id: d.id, revision: 1 },
    };
    const ip = await api.importPreview(v);
    expect(ip.errors).toEqual([]);
    await api.audit({ id: d.id, revision: 1, to: true });
    await expect(api.importSave({ ...v, confirmation: ip.confirmation })).rejects.toThrow();
    expect((await api.document({ id: d.id })).lines[0]!.quantity).toBe('5');
  });
  it('ht1/ht2/w_cb_ck_copy：合同独立保存不增库存，复制号重复拒绝，带入草稿保留来源', async () => {
    const supplier = (await app.svc.dimensions.getByCode('partner', 'S001'))!.id;
    const raw = {
      number: 'HT1',
      warehouseId,
      supplierId: supplier,
      date: '2026-01-10',
      agent: '经办人',
      lines: [{ productCode: 'P1', quantity: '5', unitPrice: '2' }],
    };
    const c = await api.saveContract(raw);
    expect(await balance()).toBe('0');
    await expect(api.saveContract(raw)).rejects.toThrow(/重复/);
    const copy = await api.saveContract({ ...raw, number: 'HT2' });
    expect(copy.id).not.toBe(c.id);
    const draft = await api.contractDraft({ id: c.id });
    expect(draft).toMatchObject({ sourceType: 'contract', sourceId: c.id, number: '' });
    expect(await balance()).toBe('0');
    await api.saveDocument({ ...draft, number: 'R1', accountId: cash });
    expect(await balance()).toBe('5');
    await expect(api.saveContract({ ...raw, id: c.id, revision: 1 })).rejects.toThrow(
      /已有来源入库/,
    );
  });
  it('w_ck_kc/w_cb_qc：两个仓库同产品、两账套同编号及同数字ID隔离，权限直调拒绝', async () => {
    await opening();
    const second = await api.saveWarehouse({ code: '02', name: '二仓' });
    expect((await api.stock({ warehouseId: second }))[0]!.balance).toBe('0');
    await api.saveDocument({ ...input('receipt', 'R1', '5'), warehouseId: second });
    expect(await balance()).toBe('10');
    const d = await api.saveDocument(input('receipt', 'R1', '1'));
    const viewer = caller(app, await app.addUser('viewer', { permissions: ['inventory.view'] }));
    expect(await viewer.products({})).toHaveLength(1);
    await expect(viewer.saveDocument(input('receipt', 'R2'))).rejects.toThrow(/权限/);
    await expect(viewer.audit({ id: d.id, revision: 1, to: true })).rejects.toThrow(/权限/);
    await expect(viewer.saveSettings({ numberRule: 'daily', autoRefresh: false })).rejects.toThrow(
      /权限/,
    );
    const noView = caller(app, await app.addUser('none'));
    await expect(noView.stock({})).rejects.toThrow(/权限/);
    const other = await createTestApp({ modules: [server], product: 'chengben' });
    try {
      const b = caller(other);
      await expect(b.document({ id: d.id })).rejects.toThrow(/不存在/);
      const w = await b.saveWarehouse({ code: '01', name: '另账仓' });
      await b.saveProduct(product());
      const bd = await b.saveDocument({ ...input('receipt', 'R1', '2'), warehouseId: w });
      expect(bd.id).toBe(1);
      expect((await api.document({ id: bd.id })).lines[0]!.quantity).toBe('5');
      expect((await b.stock({ warehouseId: w }))[0]!.balance).toBe('2');
      expect(await balance()).toBe('11');
    } finally {
      await other.close();
    }
  });
  it('w_cb_hzsj_rk/w_cb_hzsj_ck/w_ck_xsmxz1：汇总与原行一致，销售仅销售，未核算成本不伪造', async () => {
    await opening();
    const r = await api.saveDocument(input('receipt', 'R1', '5'));
    await api.saveDocument(input('issue', 'S1', '3'));
    await api.saveDocument({ ...input('issue', 'L1', '1'), category: '领用' });
    const report = await api.summary({
      filter: { warehouseId, kind: 'receipt' },
      group: 'product',
      detail: false,
      valuation: 'document',
    });
    expect(report[0]!.amountCents).toBe(r.lines[0]!.net_cents);
    expect(
      (
        await api.summary({
          filter: { warehouseId, kind: 'issue' },
          group: 'product',
          detail: false,
          valuation: 'cost',
        })
      )[0],
    ).toMatchObject({ quantity: '4', amountCents: null, costStatus: '待成本核算' });
    const sales = await api.sales({ warehouseId });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      number: 'S1',
      quantity: '3',
      costCents: null,
      costStatus: '待成本核算',
    });
    expect(sales[0]).not.toHaveProperty('profit');
  });
});
describe('fast-check 不变量', () => {
  it('w_ck_kc：数量精确往返、分税合计与金额精度', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999999999 }),
        fc.integer({ min: 0, max: 999999 }),
        fc.integer({ min: 0, max: 100 }),
        fc.boolean(),
        (q, p, t, inclusive) => {
          const qs = quantity(q);
          expect(e6(qs)).toBe(q);
          const line = priceLine(qs, new Decimal(p).div(100).toFixed(), String(t), inclusive);
          expect(line.net_cents + line.tax_cents).toBe(line.gross_cents);
          expect(Number.isSafeInteger(line.gross_cents)).toBe(true);
          if (inclusive) expect(line.gross_cents).toBe(Math.round((q * p) / 1_000_000));
        },
      ),
      { numRuns: 300 },
    );
  });
  it('w_ck_rk1/w_ck_ck1：数量守恒，修改与删除逆操作恢复', async () => {
    await opening('1000');
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        async (received, issued) => {
          const r = await api.saveDocument(input('receipt', randomUUID(), String(received)));
          const i = await api.saveDocument(input('issue', randomUUID(), String(issued)));
          expect(await balance()).toBe(String(1000 + received - issued));
          const revised = await api.saveDocument({
            ...input('issue', i.number, String(issued + 1)),
            id: i.id,
            revision: 1,
          });
          expect(await balance()).toBe(String(999 + received - issued));
          await api.removeDocument({ id: i.id, revision: revised.revision, confirmed: true });
          await api.removeDocument({ id: r.id, revision: r.revision, confirmed: true });
          expect(await balance()).toBe('1000');
        },
      ),
      { numRuns: 15 },
    );
  });
  it('w_cb_qc：事务中后续错误会回滚此前写入', async () => {
    await expect(
      app.svcFor('inventory').tx(async (t) => {
        await inventoryService(t).saveProduct(product('ROLLBACK'));
        throw new Error('故意回滚');
      }),
    ).rejects.toThrow('故意回滚');
    expect(await api.products({ keyword: 'ROLLBACK' })).toEqual([]);
  });
});
