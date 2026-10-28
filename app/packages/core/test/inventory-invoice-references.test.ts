import { afterEach, expect, it, vi } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import type { InvoiceIssueReferences, InvoiceIssueReferencesInput } from '../src';
import { withServiceScope, type CoreServices, type InventoryProviderFactory } from '../src/server';

let book: TestBook;
afterEach(async () => book?.close());
const catalog: InvoiceIssueReferences = {
  warehouses: [{ id: 1, code: 'W1', name: '合成仓库' }],
  products: [
    {
      id: 2,
      code: 'P1',
      name: '合成产品',
      specification: '测试规格',
      unit: '件',
      inventoryAccountId: null,
      salesAccountId: null,
      disabled: false,
    },
  ],
  originalDocument: { id: 3, revision: 2, number: '合成原单', date: '2026-01-10' },
};
async function fixture(
  read = async (_svc: CoreServices, _input: InvoiceIssueReferencesInput) => catalog,
) {
  const called = vi.fn(read);
  const factory: InventoryProviderFactory = vi.fn((svc: CoreServices) => ({
    snapshot: async () => {
      throw new Error('不应调用旧快照');
    },
    with: async () => {
      throw new Error('不应调用旧成本能力');
    },
    invoiceIssueReferences: (input: InvoiceIssueReferencesInput) => called(svc, input),
  }));
  book = await createTestBook({ providers: { inventory: factory } });
  return { svc: book.forModule('invoice'), called, factory };
}

it('w_fp_ck：目录桥传原始invoice身份及输入，未配置科目保留null而非假0', async () => {
  const f = await fixture();
  const input = { invoiceId: 7 };
  expect(await f.svc.inventory.invoiceIssueReferences(input)).toBe(catalog);
  expect(f.called).toHaveBeenCalledWith(f.svc, input);
  expect(f.called.mock.calls[0]![1]).toBe(input);
  expect(f.svc.moduleId).toBe('invoice');
  expect(catalog.products[0]).toMatchObject({ inventoryAccountId: null, salesAccountId: null });
  await expect(f.svc.inventory.snapshot(202601)).rejects.toMatchObject({
    data: { code: 'COST_OWNER' },
  });
});

it('w_fp_ck：原单2→3→4版本每次经provider重新获取，不复用缓存目录', async () => {
  let revision = 2;
  const f = await fixture(async () => ({
    ...catalog,
    originalDocument: { ...catalog.originalDocument!, revision },
  }));
  const inventory = f.svc.inventory;
  for (const expected of [2, 3, 4]) {
    revision = expected;
    expect(
      (await inventory.invoiceIssueReferences({ invoiceId: 7 })).originalDocument!.revision,
    ).toBe(expected);
  }
  expect(f.called).toHaveBeenCalledTimes(3);
  expect(f.factory).toHaveBeenCalledTimes(3);
});

it.each(['inventory', 'costing', 'voucher-entry', null])(
  'w_fp_ck：%s身份不能通过目录桥取得产品或仓库',
  async (moduleId) => {
    const f = await fixture();
    const svc = moduleId === null ? book.svc : book.forModule(moduleId);
    await expect(svc.inventory.invoiceIssueReferences({})).rejects.toThrow();
    expect(f.factory).not.toHaveBeenCalled();
  },
);

it('w_fp_ck：invoice缺制证权限时在provider调用前拒绝，授权用户身份不被提升', async () => {
  const f = await fixture();
  const denied = await book.addUser('catalog-denied');
  await expect(
    book.forModule('invoice', denied.user).inventory.invoiceIssueReferences({}),
  ).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  expect(f.called).not.toHaveBeenCalled();
  const allowed = await book.addUser('catalog-allowed', { permissions: ['invoice.voucher'] });
  const svc = book.forModule('invoice', allowed.user);
  expect(await svc.inventory.invoiceIssueReferences({})).toBe(catalog);
  expect(f.called.mock.calls[0]![0].user).toBe(allowed.user);
  expect(f.called.mock.calls[0]![0].user.isAdmin).toBe(false);
});

it('w_fp_ck：旧provider缺目录方法明确报能力缺失，不伪造空列表', async () => {
  book = await createTestBook({
    providers: {
      inventory: () => ({
        snapshot: async () => {
          throw new Error('旧快照不可调用');
        },
        with: async () => {
          throw new Error('旧成本不可调用');
        },
      }),
    },
  });
  await expect(
    book.forModule('invoice').inventory.invoiceIssueReferences({}),
  ).rejects.toMatchObject({ data: { code: 'INVENTORY_INVOICE_PROVIDER_MISSING' } });
});

it('w_fp_ck：事务内目录查询绑定原始事务svc和连接，失败即使被捕获仍回滚外层写入', async () => {
  const f = await fixture(async (svc) => {
    expect(svc.moduleId).toBe('invoice');
    expect(svc.db.isTransaction).toBe(true);
    throw new Error('合成目录读取失败');
  });
  await expect(
    f.svc.tx(async (svc) => {
      await svc.settings.set('catalog-write', '不应提交');
      await expect(svc.inventory.invoiceIssueReferences({ invoiceId: 7 })).rejects.toThrow(
        '合成目录读取失败',
      );
    }),
  ).rejects.toThrow('合成目录读取失败');
  expect(await f.svc.settings.get('catalog-write', null)).toBeNull();
});

it('w_fp_ck：目录返回前请求作用域已结束时拒绝发布结果，旧服务也不能重新调用', async () => {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = await fixture(async () => {
    await held;
    return catalog;
  });
  let svc: CoreServices | undefined, operation: Promise<InvoiceIssueReferences> | undefined;
  await withServiceScope(async () => {
    svc = book.forModule('invoice');
    operation = svc.inventory.invoiceIssueReferences({});
  });
  const rejected = expect(operation!).rejects.toThrow(/请求作用域/);
  finish();
  await rejected;
  await expect(svc!.inventory.invoiceIssueReferences({})).rejects.toThrow(/请求作用域/);
  expect(f.called).toHaveBeenCalledTimes(1);
});
