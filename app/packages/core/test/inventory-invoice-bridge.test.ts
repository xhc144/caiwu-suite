import { afterEach, expect, it, vi } from 'vitest';
import { isInDatabaseTransaction } from '@caiwu/db';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import type {
  InventoryCapability,
  InventoryCostingCapability,
  InvoiceIssueInput,
  InvoiceIssuePlan,
  InvoiceIssueSaveInput,
} from '../src';
import {
  withServiceScope,
  type CoreServices,
  type InventoryProvider,
  type InventoryProviderFactory,
} from '../src/server';

let book: TestBook;
afterEach(async () => book?.close());
const input: InvoiceIssueInput = {
  invoiceId: 1,
  invoiceRevision: 2,
  requestKey: 'synthetic-invoice-request',
  redLetter: false,
  warehouseId: 1,
  date: '2026-01-10',
  number: '合成出库单',
  settlementAccountId: 1,
  costAccountId: 2,
  originalDocument: null,
  newProducts: [
    {
      code: 'P1',
      name: '合成产品',
      specification: '测试规格',
      unit: '件',
      inventoryAccountId: 3,
      salesAccountId: 4,
    },
  ],
  lines: [
    {
      productCode: 'P1',
      quantity: '2',
      unitPrice: '10',
      taxRate: '13',
      netCents: 2000,
      taxCents: 260,
      totalCents: 2260,
    },
  ],
};
const plan: InvoiceIssuePlan = {
  fingerprint: 'f'.repeat(64),
  expiresAt: Date.now() + 60_000,
  stockRevision: 3,
  shortages: [],
};
const saving: InvoiceIssueSaveInput = {
  input,
  plan,
  newProductsConfirmed: true,
  negativeStockConfirmed: false,
  replacementConfirmed: false,
};
const unexpected = async (): Promise<never> => {
  throw new Error('不应进入旧成本能力');
};
const legacy: InventoryCostingCapability = {
  saveDocument: vi.fn(async () => ({ id: 9, revision: 1 })),
  removeDocument: vi.fn(unexpected),
  snapshot: vi.fn(unexpected),
  commitCosting: vi.fn(unexpected),
  cancelCosting: vi.fn(unexpected),
  lockVoucherSource: vi.fn(unexpected),
  releaseVoucherSource: vi.fn(unexpected),
};
async function fixture(options?: {
  preview?: (svc: CoreServices, value: InvoiceIssueInput) => Promise<InvoiceIssuePlan>;
  save?: (
    svc: CoreServices,
    value: InvoiceIssueSaveInput,
  ) => Promise<{ id: number; revision: number }>;
  missing?: 'preview' | 'save' | 'both';
}) {
  vi.clearAllMocks();
  const received: CoreServices[] = [];
  const oldWith = vi.fn();
  const preview = vi.fn(
    options?.preview ?? (async (_svc: CoreServices, _input: InvoiceIssueInput) => plan),
  );
  const save = vi.fn(
    options?.save ??
      (async (svc: CoreServices, value: InvoiceIssueSaveInput) => {
        expect(svc.moduleId).toBe('invoice');
        expect(svc.db.isTransaction).toBe(true);
        expect(isInDatabaseTransaction()).toBe(true);
        await svc.settings.set('new-products', value.input.newProducts);
        await svc.settings.set('issue', value.input.lines);
        return { id: 101, revision: 1 };
      }),
  );
  const factory: InventoryProviderFactory = vi.fn((svc: CoreServices): InventoryProvider => {
    received.push(svc);
    return {
      snapshot: legacy.snapshot,
      with: (run) => {
        oldWith();
        return run(legacy);
      },
      ...(options?.missing === 'preview' || options?.missing === 'both'
        ? {}
        : { previewInvoiceIssue: (value: InvoiceIssueInput) => preview(svc, value) }),
      ...(options?.missing === 'save' || options?.missing === 'both'
        ? {}
        : { saveInvoiceIssue: (value: InvoiceIssueSaveInput) => save(svc, value) }),
    };
  });
  book = await createTestBook({ providers: { inventory: factory } });
  return { svc: book.forModule('invoice'), received, factory, preview, save, oldWith };
}

it('w_fp_ck：预览传递原始invoice svc及完整输入，不伪装身份或改写金额/计划', async () => {
  const f = await fixture();
  expect(await f.svc.inventory.previewInvoiceIssue(input)).toBe(plan);
  expect(f.received).toEqual([f.svc]);
  expect(f.preview).toHaveBeenCalledWith(f.svc, input);
  expect(f.preview.mock.calls[0]![1]).toBe(input);
  expect(f.svc.moduleId).toBe('invoice');
  expect(f.oldWith).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it('w_fp_ck：发票行、新产品与库存写入使用同一core事务及原始actor，旧成本with不被调用', async () => {
  const f = await fixture();
  let transactionSvc: CoreServices | undefined;
  const result = await f.svc.tx(async (svc) => {
    transactionSvc = svc;
    await svc.settings.set('invoice-link', 101);
    return svc.inventory.with((inventory) => inventory.saveInvoiceIssue(saving));
  });
  expect(result).toEqual({ id: 101, revision: 1 });
  expect(f.received).toEqual([transactionSvc]);
  expect(transactionSvc!.user).toBe(f.svc.user);
  expect(transactionSvc!.moduleId).toBe('invoice');
  expect(f.save).toHaveBeenCalledWith(transactionSvc, saving);
  expect(f.save.mock.calls[0]![1]).toBe(saving);
  expect(await f.svc.settings.get('invoice-link', null)).toBe(101);
  expect(await f.svc.settings.get('new-products', null)).toEqual(input.newProducts);
  expect(await f.svc.settings.get('issue', null)).toEqual(input.lines);
  expect(f.oldWith).not.toHaveBeenCalled();
});

it('w_fp_ck：provider中途失败即使被调用方捕获仍毒化整批事务，发票/新产品/库存全部回滚', async () => {
  const f = await fixture({
    save: async (svc) => {
      await svc.settings.set('new-products', '不应提交');
      await svc.settings.set('issue', '不应提交');
      throw new Error('合成库存写入失败');
    },
  });
  await expect(
    f.svc.tx(async (svc) => {
      await svc.settings.set('invoice-link', '不应提交');
      await svc.inventory.with(async (inventory) => {
        await expect(inventory.saveInvoiceIssue(saving)).rejects.toThrow('合成库存写入失败');
      });
    }),
  ).rejects.toThrow('合成库存写入失败');
  for (const key of ['invoice-link', 'new-products', 'issue'])
    expect(await f.svc.settings.get(key, null)).toBeNull();
});

it('w_fp_ck：发票保存必须在core事务内，invoice仍不能直接读取旧库存快照', async () => {
  const f = await fixture();
  await expect(f.svc.inventory.with((i) => i.saveInvoiceIssue(saving))).rejects.toMatchObject({
    data: { code: 'TRANSACTION_REQUIRED' },
  });
  await expect(f.svc.inventory.snapshot(202601)).rejects.toMatchObject({
    data: { code: 'COST_OWNER' },
  });
  expect(f.factory).not.toHaveBeenCalled();
});

it.each([
  'saveDocument',
  'removeDocument',
  'snapshot',
  'commitCosting',
  'cancelCosting',
  'lockVoucherSource',
  'releaseVoucherSource',
] as const)('w_fp_ck：invoice不能通过with调用旧%s能力', async (method) => {
  const f = await fixture();
  await expect(
    f.svc.tx((svc) =>
      svc.inventory.with((i) => Reflect.apply(i[method], i, [{}]) as Promise<unknown>),
    ),
  ).rejects.toMatchObject({ data: { code: 'COST_OWNER' } });
  expect(legacy[method]).not.toHaveBeenCalled();
  expect(f.oldWith).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});

it.each(['costing', 'inventory', 'voucher-entry', null])(
  'w_fp_ck：%s身份不能调用发票预览或保存',
  async (moduleId) => {
    const f = await fixture();
    const svc = moduleId === null ? book.svc : book.forModule(moduleId);
    await expect(svc.inventory.previewInvoiceIssue(input)).rejects.toThrow();
    await expect(
      svc.tx((t) => t.inventory.with((i) => i.saveInvoiceIssue(saving))),
    ).rejects.toThrow();
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
  },
);

it('w_fp_ck：旧provider缺发票能力时明确报错，原库存保存调用保持兼容', async () => {
  const f = await fixture({ missing: 'both' });
  await expect(f.svc.inventory.previewInvoiceIssue(input)).rejects.toMatchObject({
    data: { code: 'INVENTORY_INVOICE_PROVIDER_MISSING' },
  });
  await expect(
    f.svc.tx((svc) => svc.inventory.with((i) => i.saveInvoiceIssue(saving))),
  ).rejects.toMatchObject({ data: { code: 'INVENTORY_INVOICE_PROVIDER_MISSING' } });
  const inventory = book.forModule('inventory');
  expect(
    await inventory.tx((svc) =>
      svc.inventory.with((i) =>
        i.saveDocument({
          requestKey: 'synthetic-legacy',
          kind: 'issue',
          warehouseId: 1,
          number: '合成旧单',
          date: '2026-01-10',
          category: '销售',
          lines: [],
        }),
      ),
    ),
  ).toEqual({ id: 9, revision: 1 });
  expect(f.oldWith).toHaveBeenCalledTimes(1);
});

it.each(['preview', 'save'] as const)(
  'w_fp_ck：provider只缺%s时也明确报对应能力缺失',
  async (missing) => {
    const f = await fixture({ missing });
    const action =
      missing === 'preview'
        ? f.svc.inventory.previewInvoiceIssue(input)
        : f.svc.tx((svc) => svc.inventory.with((i) => i.saveInvoiceIssue(saving)));
    await expect(action).rejects.toMatchObject({
      data: { code: 'INVENTORY_INVOICE_PROVIDER_MISSING' },
    });
  },
);

it('w_fp_ck：红字预览与保存均在provider执行前明确拒绝，不改写金额、不产生正向出库', async () => {
  const f = await fixture();
  const red = {
    ...input,
    redLetter: true,
    lines: input.lines.map((line) => ({
      ...line,
      netCents: -line.netCents,
      taxCents: -line.taxCents,
      totalCents: -line.totalCents,
    })),
  };
  const before = structuredClone(red);
  await expect(f.svc.inventory.previewInvoiceIssue(red)).rejects.toMatchObject({
    data: { code: 'INVENTORY_INVOICE_RED_UNSUPPORTED' },
  });
  expect(f.factory).not.toHaveBeenCalled();
  await expect(
    f.svc.tx(async (svc) => {
      await svc.settings.set('invoice-link', '不应提交');
      return svc.inventory.with((i) => i.saveInvoiceIssue({ ...saving, input: red }));
    }),
  ).rejects.toMatchObject({ data: { code: 'INVENTORY_INVOICE_RED_UNSUPPORTED' } });
  expect(red).toEqual(before);
  expect(f.preview).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(await f.svc.settings.get('invoice-link', null)).toBeNull();
});

it('w_fp_ck：回调结束后的发票能力不能逃逸重用，provider没有第二次写入', async () => {
  const f = await fixture();
  let escaped: InventoryCapability | undefined;
  await f.svc.tx((svc) =>
    svc.inventory.with(async (i) => {
      escaped = i;
    }),
  );
  await expect(escaped!.saveInvoiceIssue(saving)).rejects.toMatchObject({
    data: { code: 'INVENTORY_SCOPE_EXPIRED' },
  });
  expect(f.save).not.toHaveBeenCalled();
});

it('w_fp_ck：请求结束后的预览服务不可跨作用域使用', async () => {
  const f = await fixture();
  let escaped: CoreServices | undefined;
  await withServiceScope(async () => {
    escaped = book.forModule('invoice');
    await escaped.inventory.previewInvoiceIssue(input);
  });
  await expect(escaped!.inventory.previewInvoiceIssue(input)).rejects.toThrow(/请求作用域/);
  expect(f.preview).toHaveBeenCalledTimes(1);
});

it('w_fp_ck：未等待的发票库存写入必须真实排空并回滚，不能先提交外层发票行', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture({
    save: async (svc) => {
      entered();
      await pending;
      await svc.settings.set('issue', '不应提交');
      return { id: 1, revision: 1 };
    },
  });
  const task = f.svc.tx(async (svc) => {
    await svc.settings.set('invoice-link', '不应提交');
    return svc.inventory.with(async (i) => {
      void i.saveInvoiceIssue(saving);
      await started;
    });
  });
  const rejected = expect(task).rejects.toMatchObject({
    data: { code: 'INVENTORY_OPERATION_PENDING' },
  });
  await started;
  await new Promise<void>((resolve) => setImmediate(resolve));
  release();
  await rejected;
  expect(await f.svc.settings.get('issue', null)).toBeNull();
  expect(await f.svc.settings.get('invoice-link', null)).toBeNull();
});
