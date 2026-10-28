import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCoreServices, type CoreServices } from '@caiwu/core/server';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import type { InvoiceIssueInput, InvoiceIssuePlan, SaveInvoiceIssueInput } from '../invoice-issue';
import { previewInvoiceIssue, saveInvoiceIssue } from '../server/invoice-issue';
import type { invoiceIssueReferences } from '../server/invoice-issue';
import type { InventoryTables } from '../server/migrations';
import server from '../server';

let app: TestApp, invoice: CoreServices;
let warehouseId: number, cash: number, cost: number, inventoryAccount: number, sales: number;
const api = () => app.call(server);
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
  invoice = app.svcFor('invoice');
  warehouseId = await api().saveWarehouse({ code: '01', name: '发票出库仓' });
  cash = (await app.svc.accounts.require('1001')).id;
  cost = (await app.svc.accounts.require('6401')).id;
  inventoryAccount = (await app.svc.accounts.require('1405')).id;
  sales = (await app.svc.accounts.require('6001')).id;
  await api().saveProduct({
    code: 'P1',
    name: '库存商品',
    inventoryAccountId: inventoryAccount,
    salesAccountId: sales,
  });
  await api().saveOpening({
    warehouseId,
    revision: 0,
    rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }],
  });
});
afterEach(async () => {
  await app.close();
});
function input(patch: Partial<InvoiceIssueInput> = {}): InvoiceIssueInput {
  return {
    invoiceId: 1,
    invoiceRevision: 1,
    redLetter: false,
    requestKey: randomUUID(),
    warehouseId,
    date: '2026-01-10',
    number: 'FP-OUT-1',
    settlementAccountId: cash,
    costAccountId: cost,
    newProducts: [],
    lines: [
      {
        productCode: 'P1',
        quantity: '2',
        unitPrice: '3.33',
        taxRate: '13',
        netCents: 666,
        taxCents: 87,
        totalCents: 753,
      },
    ],
    ...patch,
  };
}
const save = (
  v: InvoiceIssueInput,
  plan: InvoiceIssuePlan,
  options: Partial<Omit<SaveInvoiceIssueInput, 'input' | 'plan'>> = {},
  svc = invoice,
) =>
  svc.tx((t) =>
    saveInvoiceIssue(t, {
      input: v,
      plan,
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: false,
      ...options,
    }),
  );
const stock = async () => (await api().stock({ warehouseId, productCode: 'P1' }))[0]!.balance;
type InvoiceProvider = {
  saveInvoiceIssue: (input: SaveInvoiceIssueInput) => Promise<{ id: number; revision: number }>;
  invoiceIssueReferences: (input: {
    invoiceId?: number;
  }) => ReturnType<typeof invoiceIssueReferences>;
  previewInvoiceIssue: (input: InvoiceIssueInput) => Promise<InvoiceIssuePlan>;
  snapshot: (period: number) => Promise<unknown>;
  with<T>(
    run: (cap: {
      saveInvoiceIssue: (input: SaveInvoiceIssueInput) => Promise<{ id: number; revision: number }>;
    }) => Promise<T>,
  ): Promise<T>;
};
const provider = (svc = invoice) => server.providers!.inventory!(svc) as unknown as InvoiceProvider;

it('w_fp_pz_ckd：真实core桥调用工厂顶层保存，外层失败回滚且能力不能逃逸', async () => {
  // 直接调用运行时 core 桥；窄类型仅兼容尚未接回新契约的模块基线。
  const bridge = (svc: CoreServices) => svc.inventory as unknown as InvoiceProvider;
  const v = input(),
    plan = await bridge(invoice).previewInvoiceIssue(v);
  const raw = {
    input: v,
    plan,
    newProductsConfirmed: false,
    negativeStockConfirmed: false,
    replacementConfirmed: false,
  };
  await expect(
    invoice.tx(async (t) => {
      await bridge(t).with((cap) => cap.saveInvoiceIssue(raw));
      throw new Error('模拟发票状态保存失败');
    }),
  ).rejects.toThrow('模拟发票状态保存失败');
  expect(await stock()).toBe('10');
  expect(await api().documents({})).toHaveLength(0);
  let escaped!: (input: SaveInvoiceIssueInput) => Promise<{ id: number; revision: number }>;
  const saved = await invoice.tx((t) =>
    bridge(t).with(async (cap) => {
      escaped = cap.saveInvoiceIssue;
      return cap.saveInvoiceIssue(raw);
    }),
  );
  expect((await api().document({ id: saved.id })).source_type).toBe('invoice');
  expect(await stock()).toBe('8');
  await expect(escaped(raw)).rejects.toThrow(/事务|作用域/);
  await expect(bridge(invoice).with((cap) => cap.saveInvoiceIssue(raw))).rejects.toThrow(/svc\.tx/);
  await expect(
    app.svcFor('inventory').tx((t) => bridge(t).with((cap) => cap.saveInvoiceIssue(raw))),
  ).rejects.toThrow(/发票/);
  expect(await stock()).toBe('8');
});

it('w_fp_pz_ckd：工厂顶层委派只接受当前事务服务并保留发票权限', async () => {
  const v = input(),
    raw = {
      input: v,
      plan: await provider().previewInvoiceIssue(v),
      newProductsConfirmed: false,
      negativeStockConfirmed: false,
      replacementConfirmed: false,
    };
  await expect(provider().saveInvoiceIssue(raw)).rejects.toThrow(/同一事务/);
  let escaped!: InvoiceProvider;
  await invoice.tx(async (t) => {
    escaped = provider(t);
  });
  await expect(invoice.tx(() => escaped.saveInvoiceIssue(raw))).rejects.toThrow(/事务|作用域/);
  await expect(
    app.svcFor('inventory').tx((t) => provider(t).saveInvoiceIssue(raw)),
  ).rejects.toThrow(/只能从发票/);
  const clerk = await app.svc.users.create({
    code: 'top-save-reader',
    name: '发票只读',
    password: '',
    permissions: ['invoice.view'],
  });
  await expect(
    createCoreServices({ ...invoice.ctx, user: clerk }).tx((t) =>
      provider(t).saveInvoiceIssue(raw),
    ),
  ).rejects.toThrow(/权限/);
  const saved = await invoice.tx((t) => provider(t).saveInvoiceIssue(raw));
  expect((await api().document({ id: saved.id })).source_type).toBe('invoice');
  expect(await stock()).toBe('8');
});

it('w_fp_pz_ckd：真实目录工厂按专用权限返回仓库产品及本票原单最新版本，不借旧快照', async () => {
  await api().saveWarehouse({ code: '02', name: '停用仓', disabled: true });
  await api().saveProduct({ code: 'P2', name: '停用未映射产品', disabled: true });
  const clerk = await app.svc.users.create({
    code: 'reference-clerk',
    name: '发票制证',
    password: '',
    permissions: ['invoice.voucher'],
  });
  const worker = createCoreServices({ ...invoice.ctx, user: clerk });
  const bound = provider(worker);
  await expect(bound.snapshot(202601)).rejects.toThrow(/库存|成本|模块/);
  const references = await bound.invoiceIssueReferences({});
  expect(references.warehouses).toEqual([{ id: warehouseId, code: '01', name: '发票出库仓' }]);
  expect(references.products.find((p) => p.code === 'P1')).toMatchObject({
    name: '库存商品',
    specification: '',
    unit: '件',
    inventoryAccountId: inventoryAccount,
    salesAccountId: sales,
    disabled: false,
  });
  expect(references.products.find((p) => p.code === 'P2')).toMatchObject({
    inventoryAccountId: null,
    salesAccountId: null,
    disabled: true,
  });
  expect(references.originalDocument).toBeNull();
  const v = input(),
    d = await save(v, await previewInvoiceIssue(invoice, v));
  const r = await provider().invoiceIssueReferences({ invoiceId: 1 });
  expect(r.originalDocument).toEqual({
    id: d.id,
    revision: d.revision,
    number: v.number,
    date: v.date,
  });
  const audited = await api().audit({ id: d.id, revision: d.revision, to: true });
  expect(
    (await provider().invoiceIssueReferences({ invoiceId: 1 })).originalDocument?.revision,
  ).toBe(audited.revision);
  expect((await provider().invoiceIssueReferences({ invoiceId: 2 })).originalDocument).toBeNull();
  await expect(provider(app.svcFor('inventory')).invoiceIssueReferences({})).rejects.toThrow(
    /只能从发票/,
  );
  const reader = await app.svc.users.create({
    code: 'reference-reader',
    name: '发票只读',
    password: '',
    permissions: ['invoice.view'],
  });
  await expect(
    provider(createCoreServices({ ...invoice.ctx, user: reader })).invoiceIssueReferences({}),
  ).rejects.toThrow(/权限/);
});

it('w_fp_pz_ckd：发票版本2保存后升3，按版本3重新预览原位生成并同事务升4', async () => {
  // 临时表只模拟另一个业务域的版本写入，未读取或修改发票模块表。
  await sql`CREATE TEMP TABLE inventory_test_invoice_state(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,state TEXT NOT NULL)`.execute(
    app.svc.db,
  );
  await sql`INSERT INTO inventory_test_invoice_state VALUES(1,2,'audited')`.execute(app.svc.db);
  const first = input({ invoiceRevision: 2 }),
    firstPlan = await provider().previewInvoiceIssue(first);
  const firstSaved = await invoice.tx(async (t) => {
    const saved = await provider(t).with((cap) =>
      cap.saveInvoiceIssue({
        input: first,
        plan: firstPlan,
        newProductsConfirmed: false,
        negativeStockConfirmed: false,
        replacementConfirmed: false,
      }),
    );
    await sql`UPDATE inventory_test_invoice_state SET revision=3,state='issued' WHERE id=1 AND revision=2`.execute(
      t.db,
    );
    return saved;
  });
  const state3 = await sql<{
    revision: number;
    state: string;
  }>`SELECT revision,state FROM inventory_test_invoice_state WHERE id=1`.execute(app.svc.db);
  expect(state3.rows[0]).toEqual({ revision: 3, state: 'issued' });
  const original = (await provider().invoiceIssueReferences({ invoiceId: 1 })).originalDocument!;
  const next = input({
    invoiceRevision: 3,
    requestKey: randomUUID(),
    originalDocument: { id: original.id, revision: original.revision },
    lines: [
      {
        productCode: 'P1',
        quantity: '3',
        unitPrice: '3.33',
        taxRate: '13',
        netCents: 999,
        taxCents: 130,
        totalCents: 1129,
      },
    ],
  });
  const nextPlan = await provider().previewInvoiceIssue(next);
  const secondSaved = await invoice.tx(async (t) => {
    const saved = await provider(t).with((cap) =>
      cap.saveInvoiceIssue({
        input: next,
        plan: nextPlan,
        newProductsConfirmed: false,
        negativeStockConfirmed: false,
        replacementConfirmed: true,
      }),
    );
    await sql`UPDATE inventory_test_invoice_state SET revision=4,state='issued' WHERE id=1 AND revision=3`.execute(
      t.db,
    );
    return saved;
  });
  expect(secondSaved.id).toBe(firstSaved.id);
  expect(secondSaved.revision).toBe(firstSaved.revision + 1);
  expect(
    (await provider().invoiceIssueReferences({ invoiceId: 1 })).originalDocument?.revision,
  ).toBe(secondSaved.revision);
  expect(
    (
      await sql<{
        revision: number;
        state: string;
      }>`SELECT revision,state FROM inventory_test_invoice_state WHERE id=1`.execute(app.svc.db)
    ).rows[0],
  ).toEqual({ revision: 4, state: 'issued' });
  expect(await stock()).toBe('7');
  expect(await api().documents({})).toHaveLength(1);
  await expect(provider().previewInvoiceIssue(first)).rejects.toThrow(/已经后续更新/);
});

it('w_fp_pz_ckd：没有仓库进销存的产品形态明确拒绝专用出库', async () => {
  const other = await createTestApp({ modules: [server], product: 'qingsong' });
  try {
    await expect(previewInvoiceIssue(other.svcFor('invoice'), input())).rejects.toThrow(
      /未启用仓库进销存/,
    );
  } finally {
    await other.close();
  }
});

it('w_fp_pz_ckd：真实预览不写库存，多税率明细与发票来源同事务保存', async () => {
  const v = input({
    lines: [
      {
        productCode: 'P1',
        quantity: '2',
        unitPrice: '3.33',
        taxRate: '13',
        netCents: 666,
        taxCents: 87,
        totalCents: 753,
      },
      {
        productCode: 'P1',
        quantity: '1',
        unitPrice: '5',
        taxRate: '9',
        netCents: 500,
        taxCents: 45,
        totalCents: 545,
      },
    ],
  });
  const before = await api().context();
  const p = await previewInvoiceIssue(invoice, v);
  expect(p).toMatchObject({ stockRevision: before.control.stock_revision, shortages: [] });
  expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(p.expiresAt).toBeGreaterThan(Date.now());
  expect(await api().documents({})).toHaveLength(0);
  const saved = await save(v, p);
  const d = await api().document({ id: saved.id });
  expect(d).toMatchObject({
    source_type: 'invoice',
    source_id: 1,
    kind: 'issue',
    category: '销售',
    audited_by: null,
  });
  expect(d.lines.map((l) => [l.tax_rate, l.net_cents, l.tax_cents, l.gross_cents])).toEqual([
    ['13', 666, 87, 753],
    ['9', 500, 45, 545],
  ]);
  expect(await stock()).toBe('7');
  expect(
    await app.svc.db
      .withTables<InventoryTables>()
      .selectFrom('inventory_invoice_source')
      .selectAll()
      .execute(),
  ).toHaveLength(1);
});

it('w_fp_pz_ckd：同请求并发只保存一次，发票来源唯一，不同内容不能复用请求', async () => {
  const v = input(),
    p = await previewInvoiceIssue(invoice, v);
  const [a, b] = await Promise.all([save(v, p), save(v, p)]);
  expect(a.id).toBe(b.id);
  expect(await stock()).toBe('8');
  expect(await api().documents({})).toHaveLength(1);
  await expect(previewInvoiceIssue(invoice, { ...v, requestKey: randomUUID() })).rejects.toThrow(
    /已经转出库/,
  );
  await expect(save({ ...v, invoiceRevision: 2 }, p)).rejects.toThrow(/其他内容/);
  expect((await previewInvoiceIssue(invoice, v)).shortages).toEqual([]);
});

it('w_fp_pz_ckd：待新增产品先确认，负库存独立确认，不确认不创建档案或单据', async () => {
  const v = input({
    newProducts: [
      {
        code: 'NEW',
        name: '发票新商品',
        specification: '规格',
        unit: '件',
        inventoryAccountId: inventoryAccount,
        salesAccountId: sales,
      },
    ],
    lines: [
      {
        productCode: 'NEW',
        quantity: '2',
        unitPrice: '3',
        taxRate: '0',
        netCents: 600,
        taxCents: 0,
        totalCents: 600,
      },
    ],
  });
  const p = await previewInvoiceIssue(invoice, v);
  expect(p.shortages).toEqual([
    {
      warehouseId,
      productCode: 'NEW',
      availableQuantity: '0',
      requiredQuantity: '2',
      shortageQuantity: '2',
    },
  ]);
  expect(await api().products({ keyword: 'NEW' })).toHaveLength(0);
  await expect(save(v, p)).rejects.toThrow(/确认新增产品/);
  await expect(save(v, p, { newProductsConfirmed: true })).rejects.toThrow(/尚未明确确认/);
  expect(await api().products({ keyword: 'NEW' })).toHaveLength(0);
  const d = await save(v, p, { newProductsConfirmed: true, negativeStockConfirmed: true });
  expect(await api().products({ keyword: 'NEW' })).toHaveLength(1);
  expect((await api().stock({ warehouseId, productCode: 'NEW' }))[0]!.balance).toBe('-2');
  expect((await api().document({ id: d.id })).source_type).toBe('invoice');
});

it('w_fp_pz_ckd：替换必须原单和版本及明确确认，更新只扣回原数量一次', async () => {
  const first = input(),
    d = await save(first, await previewInvoiceIssue(invoice, first));
  const v = input({
    invoiceRevision: 2,
    originalDocument: d,
    lines: [
      {
        productCode: 'P1',
        quantity: '4',
        unitPrice: '2',
        taxRate: '0',
        netCents: 800,
        taxCents: 0,
        totalCents: 800,
      },
    ],
  });
  const p = await previewInvoiceIssue(invoice, v);
  await expect(save(v, p)).rejects.toThrow(/替换原发票出库单需要明确确认/);
  expect(await stock()).toBe('8');
  const changed = await save(v, p, { replacementConfirmed: true });
  expect(changed.id).toBe(d.id);
  expect(changed.revision).toBe(d.revision + 1);
  expect(await stock()).toBe('6');
  await expect(save(first, await previewInvoiceIssue(invoice, v))).rejects.toThrow(/已经后续更新/);
  await expect(
    previewInvoiceIssue(invoice, { ...v, requestKey: randomUUID(), originalDocument: d }),
  ).rejects.toThrow(/已被修改/);
});

it('w_fp_pz_ckd：已审核、已核算或关联凭证的原单禁止替换', async () => {
  const v = input(),
    saved = await save(v, await previewInvoiceIssue(invoice, v));
  const d = await api().audit({ ...saved, to: true });
  const replace = input({
    invoiceRevision: 2,
    originalDocument: { id: d.id, revision: d.revision },
  });
  await expect(previewInvoiceIssue(invoice, replace)).rejects.toThrow(/已审核/);
  const a = await api().audit({ id: d.id, revision: d.revision, to: false });
  await app.svc.db
    .withTables<InventoryTables>()
    .updateTable('inventory_document')
    .set({ calculation_status: 'calculated' })
    .where('id', '=', a.id)
    .execute();
  await expect(
    previewInvoiceIssue(invoice, {
      ...replace,
      originalDocument: { id: a.id, revision: a.revision },
    }),
  ).rejects.toThrow(/已核算/);
});

it('w_fp_pz_ckd：新旧期间都须可写，已结账不能用跨月替换绕过', async () => {
  const v = input(),
    d = await save(v, await previewInvoiceIssue(invoice, v));
  await app.svc.periods.setStatus(202601, 'closed');
  await expect(
    previewInvoiceIssue(invoice, input({ invoiceId: 2, number: 'FP2' })),
  ).rejects.toThrow(/结账/);
  await expect(
    previewInvoiceIssue(invoice, input({ date: '2026-02-10', originalDocument: d })),
  ).rejects.toThrow(/结账/);
});

it('w_fp_pz_ckd：库存与档案版本、内容、过期和展示差额均绑定预览计划', async () => {
  const v = input(),
    p = await previewInvoiceIssue(invoice, v);
  await expect(save({ ...v, number: 'OTHER' }, p)).rejects.toThrow(/内容.*变化/);
  await expect(save(v, { ...p, expiresAt: 1 })).rejects.toThrow(/过期/);
  await expect(save(v, { ...p, fingerprint: 'a'.repeat(64) })).rejects.toThrow(/内容.*变化/);
  await expect(
    save(v, {
      ...p,
      shortages: [
        {
          warehouseId,
          productCode: 'P1',
          availableQuantity: '0',
          requiredQuantity: '2',
          shortageQuantity: '2',
        },
      ],
    }),
  ).rejects.toThrow(/库存差额/);
  await api().saveProduct({ code: 'P2', name: '产品变化' });
  await expect(save(v, p)).rejects.toThrow(/库存已变化/);
  expect(await api().documents({})).toHaveLength(0);
});

it('w_fp_pz_ckd：新产品及单据实际写入后失败，整批档案、库存、来源、日志及请求回滚', async () => {
  const v = input({
    newProducts: [
      {
        code: 'NEW',
        name: '待回滚产品',
        specification: '',
        unit: '件',
        inventoryAccountId: inventoryAccount,
        salesAccountId: sales,
      },
    ],
    lines: [
      {
        productCode: 'NEW',
        quantity: '1',
        unitPrice: '1',
        taxRate: '0',
        netCents: 100,
        taxCents: 0,
        totalCents: 100,
      },
    ],
  });
  const p = await previewInvoiceIssue(invoice, v),
    before = await api().context(),
    logs = await app.svc.log.list();
  await sql`CREATE TEMP TRIGGER fail_invoice_request BEFORE INSERT ON inventory_invoice_request BEGIN SELECT RAISE(ABORT,'请求记录写失败'); END`.execute(
    app.svc.db,
  );
  await expect(
    save(v, p, { newProductsConfirmed: true, negativeStockConfirmed: true }),
  ).rejects.toThrow(/请求记录写失败/);
  expect(await api().products({ keyword: 'NEW' })).toHaveLength(0);
  expect(await api().documents({})).toHaveLength(0);
  expect((await api().context()).control.stock_revision).toBe(before.control.stock_revision);
  expect(await app.svc.log.list()).toEqual(logs);
  expect(
    await app.svc.db
      .withTables<InventoryTables>()
      .selectFrom('inventory_invoice_source')
      .selectAll()
      .execute(),
  ).toHaveLength(0);
  await sql`DROP TRIGGER fail_invoice_request`.execute(app.svc.db);
  await save(v, p, { newProductsConfirmed: true, negativeStockConfirmed: true });
  expect(await api().documents({})).toHaveLength(1);
});

it('w_fp_pz_ckd：普通出库入口不能修改、删除、复制或反冲发票来源单', async () => {
  const v = input(),
    d = await save(v, await previewInvoiceIssue(invoice, v));
  await expect(api().removeDocument({ ...d, confirmed: true })).rejects.toThrow(/发票/);
  await expect(api().copyDocument({ id: d.id })).rejects.toThrow(/发票/);
  await expect(
    api().saveDocument({
      ...d,
      requestKey: randomUUID(),
      kind: 'issue',
      warehouseId,
      date: v.date,
      number: v.number,
      category: '销售',
      accountId: cash,
      costAccountId: cost,
      taxRate: '13',
      lines: [{ productCode: 'P1', quantity: '2', unitPrice: '3.33' }],
    }),
  ).rejects.toThrow(/发票/);
  await expect(
    api().previewReversal({
      ...d,
      requestKey: randomUUID(),
      date: v.date,
      number: 'FC',
      accountId: cost,
      unitPrices: ['2'],
    }),
  ).rejects.toThrow(/发票/);
  expect(await stock()).toBe('8');
});

it('w_fp_pz_ckd：红字标记或负数退货明确拒绝，金额税率差异不静默改写', async () => {
  const v = input();
  await expect(previewInvoiceIssue(invoice, { ...v, redLetter: true })).rejects.toThrow(
    /红字.*不能转成正向出库/,
  );
  await expect(
    previewInvoiceIssue(invoice, { ...v, lines: [{ ...v.lines[0]!, quantity: '-2' }] }),
  ).rejects.toThrow(/红字/);
  await expect(
    previewInvoiceIssue(invoice, { ...v, lines: [{ ...v.lines[0]!, totalCents: 754 }] }),
  ).rejects.toThrow(/金额.*不一致|净额.*不一致/);
  await expect(
    previewInvoiceIssue(invoice, { ...v, lines: [{ ...v.lines[0]!, taxRate: '101' }] }),
  ).rejects.toThrow(/税率/);
  expect(await api().documents({})).toHaveLength(0);
});

it('w_fp_pz_ckd：同产品多行累计检查，当前负库存可准确预览', async () => {
  const v = input({
    lines: [1, 2].map(() => ({
      productCode: 'P1',
      quantity: '6',
      unitPrice: '1',
      taxRate: '0',
      netCents: 600,
      taxCents: 0,
      totalCents: 600,
    })),
  });
  const p = await previewInvoiceIssue(invoice, v);
  expect(p.shortages[0]).toMatchObject({
    availableQuantity: '10',
    requiredQuantity: '12',
    shortageQuantity: '2',
  });
  await save(v, p, { negativeStockConfirmed: true });
  expect(await stock()).toBe('-2');
  const next = await previewInvoiceIssue(invoice, input({ invoiceId: 2, number: 'FP2' }));
  expect(next.shortages[0]).toMatchObject({
    availableQuantity: '-2',
    requiredQuantity: '2',
    shortageQuantity: '4',
  });
});

it('w_fp_pz_ckd：预览数量支持累计超过单行九位的库存差额', async () => {
  const v = input({
    lines: [1, 2].map(() => ({
      productCode: 'P1',
      quantity: '999999999',
      unitPrice: '0',
      taxRate: '0',
      netCents: 0,
      taxCents: 0,
      totalCents: 0,
    })),
  });
  const p = await previewInvoiceIssue(invoice, v);
  expect(p.shortages[0]).toMatchObject({
    requiredQuantity: '1999999998',
    shortageQuantity: '1999999988',
  });
  await save(v, p, { negativeStockConfirmed: true });
  expect(await stock()).toBe('-1999999988');
});

it('w_fp_pz_ckd：预览绑定当前账套和操作员，不可跨账套或转交他人保存', async () => {
  const v = input(),
    p = await previewInvoiceIssue(invoice, v);
  const otherUser = await app.svc.users.create({
    code: 'invoice-admin2',
    name: '另一操作员',
    password: '',
    isAdmin: true,
  });
  const otherActor = createCoreServices({ ...invoice.ctx, user: otherUser });
  await expect(save(v, p, {}, otherActor)).rejects.toThrow(/操作员.*变化/);
  const other = await createTestApp({ modules: [server] });
  try {
    const a = other.call(server);
    await a.saveWarehouse({ code: '01', name: '发票出库仓' });
    await a.saveProduct({
      code: 'P1',
      name: '库存商品',
      inventoryAccountId: inventoryAccount,
      salesAccountId: sales,
    });
    await a.saveOpening({
      warehouseId,
      revision: 0,
      rows: [{ productCode: 'P1', quantity: '10', unitPrice: '2' }],
    });
    await expect(save(v, p, {}, other.svcFor('invoice'))).rejects.toThrow(/账套.*变化/);
    expect(await a.documents({})).toHaveLength(0);
  } finally {
    await other.close();
  }
  expect(await api().documents({})).toHaveLength(0);
});

it('w_fp_pz_ckd：仅invoice身份和制证权限可用，负库存另需例外权限', async () => {
  await expect(previewInvoiceIssue(app.svcFor('inventory'), input())).rejects.toThrow(/只能从发票/);
  const user = await app.svc.users.create({
    code: 'invoice-reader',
    name: '发票只读',
    password: '',
    permissions: ['invoice.view'],
  });
  const reader = createCoreServices({ ...invoice.ctx, user });
  await expect(previewInvoiceIssue(reader, input())).rejects.toThrow(/权限/);
  const clerk = await app.svc.users.create({
    code: 'invoice-clerk',
    name: '发票制证',
    password: '',
    permissions: ['invoice.voucher'],
  });
  const worker = createCoreServices({ ...invoice.ctx, user: clerk });
  const v = input({
    lines: [
      {
        productCode: 'P1',
        quantity: '11',
        unitPrice: '1',
        taxRate: '0',
        netCents: 1100,
        taxCents: 0,
        totalCents: 1100,
      },
    ],
  });
  const p = await previewInvoiceIssue(worker, v);
  await expect(save(v, p, { negativeStockConfirmed: true }, worker)).rejects.toThrow(/权限/);
  expect(await stock()).toBe('10');
});

it('w_fp_pz_ckd：写能力必须在当前真实事务中使用，不能逃逸回调', async () => {
  const v = input(),
    p = await previewInvoiceIssue(invoice, v);
  const raw = {
    input: v,
    plan: p,
    newProductsConfirmed: false,
    negativeStockConfirmed: false,
    replacementConfirmed: false,
  };
  await expect(saveInvoiceIssue(invoice, raw)).rejects.toThrow(/同一事务/);
  let escaped!: CoreServices;
  await invoice.tx(async (t) => {
    escaped = t;
  });
  await expect(saveInvoiceIssue(escaped, raw)).rejects.toThrow(/同一事务/);
  await expect(invoice.tx(() => saveInvoiceIssue(escaped, raw))).rejects.toThrow(/事务|作用域/);
  expect(await api().documents({})).toHaveLength(0);
});

it('w_fp_pz_ckd：旧单必须属于同一发票，任意库存单据不能被接管', async () => {
  const v = input(),
    d = await save(v, await previewInvoiceIssue(invoice, v));
  await expect(
    previewInvoiceIssue(invoice, input({ invoiceId: 2, number: 'FP2', originalDocument: d })),
  ).rejects.toThrow(/没有这张来源出库单/);
  const old = await api().saveDocument({
    requestKey: randomUUID(),
    kind: 'issue',
    warehouseId,
    number: 'MANUAL',
    date: '2026-01-10',
    category: '领用',
    costAccountId: cost,
    lines: [{ productCode: 'P1', quantity: '1', unitPrice: '1' }],
  });
  await expect(
    previewInvoiceIssue(
      invoice,
      input({ originalDocument: { id: old.id, revision: old.revision } }),
    ),
  ).rejects.toThrow(/不能再生成/);
  expect(await stock()).toBe('7');
});

it('w_fp_pz_ckd：新产品重号、停用产品、缺少产品、非末级或停用科目阻止生成', async () => {
  const v = input();
  await expect(
    previewInvoiceIssue(invoice, {
      ...v,
      newProducts: [
        {
          code: 'P1',
          name: '重号',
          specification: '',
          unit: '件',
          inventoryAccountId: inventoryAccount,
          salesAccountId: sales,
        },
      ],
    }),
  ).rejects.toThrow(/已存在/);
  await expect(
    previewInvoiceIssue(invoice, { ...v, lines: [{ ...v.lines[0]!, productCode: 'MISSING' }] }),
  ).rejects.toThrow(/不存在/);
  const parent = (await app.svc.accounts.require('1002')).id;
  await expect(previewInvoiceIssue(invoice, { ...v, costAccountId: parent })).rejects.toThrow(
    /末级/,
  );
  const product = (await api().products({}))[0]!;
  await api().saveProduct({ ...product, disabled: true });
  await expect(previewInvoiceIssue(invoice, v)).rejects.toThrow(/停用/);
  expect(await api().documents({})).toHaveLength(0);
});

it('w_fp_pz_ckd：真实注册provider提供专用预览和写能力，发票不能调用通用库存写入', async () => {
  type Provider = {
    previewInvoiceIssue: (v: InvoiceIssueInput) => Promise<InvoiceIssuePlan>;
    with<T>(
      run: (cap: {
        saveInvoiceIssue: (v: SaveInvoiceIssueInput) => Promise<{ id: number; revision: number }>;
        saveDocument: (v: unknown) => Promise<unknown>;
      }) => Promise<T>,
    ): Promise<T>;
  };
  // The provider is real; this local type only exposes methods pending the parallel core contract merge.
  const factory = server.providers!.inventory!;
  const bound = factory(invoice) as unknown as Provider;
  const v = input(),
    plan = await bound.previewInvoiceIssue(v);
  const d = await invoice.tx((t) =>
    (factory(t) as unknown as Provider).with((cap) =>
      cap.saveInvoiceIssue({
        input: v,
        plan,
        newProductsConfirmed: false,
        negativeStockConfirmed: false,
        replacementConfirmed: false,
      }),
    ),
  );
  expect((await api().document({ id: d.id })).source_type).toBe('invoice');
  expect(await stock()).toBe('8');
  await expect(
    invoice.tx((t) => (factory(t) as unknown as Provider).with((cap) => cap.saveDocument({}))),
  ).rejects.toThrow(/专用出库/);
});
