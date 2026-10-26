import { afterEach, expect, it, vi } from 'vitest';
import { isInDatabaseTransaction } from '@caiwu/db';
import type { InventoryCostingCapability, InventorySnapshot } from '../src';
import { withServiceScope, type CoreServices, type InventoryProviderFactory } from '../src/server';
import { createTestBook, type TestBook } from '@caiwu/testkit';

const snapshot: InventorySnapshot = {
  version: 1,
  bookId: 'synthetic',
  startPeriod: 202601,
  period: 202601,
  cutoffDate: '2026-01-31',
  stockRevision: 0,
  openingRevision: 0,
  actorId: 1,
  moduleId: 'costing',
  fingerprint: 'f'.repeat(64),
  periodState: 'open',
  previousBatchId: null,
  periodOpeningReady: true,
  control: { costCutoffDate: null, costPeriod: null, costBatch: null, openingLocked: false },
  products: [],
  warehouses: [],
  opening: [],
  documents: [],
  movements: [],
  counts: [],
  batches: [],
  voucherSources: [],
  periodOpening: [],
};
const capability: InventoryCostingCapability = {
  snapshot: async () => snapshot,
  commitCosting: async (input) => ({
    batchId: 'test',
    revision: 1,
    period: input.period,
    status: 'calculated',
  }),
  cancelCosting: async () => ({
    batchId: 'test',
    revision: 2,
    period: 202601,
    status: 'cancelled',
  }),
  lockVoucherSource: async (input) => ({
    documentId: input.documentId,
    revision: input.expectedRevision + 1,
    voucherId: input.voucherId,
    purpose: input.purpose,
  }),
  releaseVoucherSource: async (input) => ({
    documentId: input.documentId,
    revision: input.expectedRevision + 1,
    purpose: input.purpose,
  }),
};
let book: TestBook;
afterEach(async () => book?.close());

it('工厂每次收到原始svc，事务中保留同一对象/连接/actor/module和数据库ALS', async () => {
  const received: CoreServices[] = [];
  const factory: InventoryProviderFactory = vi.fn((svc) => {
    received.push(svc);
    return {
      snapshot: async () => snapshot,
      with: async (run) => {
        expect(svc.db.isTransaction).toBe(true);
        expect(isInDatabaseTransaction()).toBe(true);
        return run(capability);
      },
    };
  });
  book = await createTestBook({ providers: { inventory: factory } });
  const svc = book.forModule('costing');
  expect(await svc.inventory.snapshot(202601)).toBe(snapshot);
  expect(await svc.inventory.snapshot(202601)).toBe(snapshot);
  await svc.tx((t) =>
    t.inventory.with(async (inv) => {
      expect(received.at(-1)).toBe(t);
      expect(t.user).toBe(svc.user);
      expect(t.moduleId).toBe('costing');
      expect(await inv.snapshot(202601)).toBe(snapshot);
    }),
  );
  expect(received[0]).toBe(svc);
  expect(received[1]).toBe(svc);
  expect(received[2]).not.toBe(svc);
  expect(factory).toHaveBeenCalledTimes(3);
});

it('请求中的未绑定读能力不可跨异步作用域使用；后台子任务在请求结束后失效', async () => {
  book = await createTestBook({
    providers: {
      inventory: () => ({ snapshot: async () => snapshot, with: (run) => run(capability) }),
    },
  });
  let escaped: CoreServices | undefined;
  let detached: Promise<void> | undefined;
  let release: (() => void) | undefined;
  await withServiceScope(async () => {
    escaped = book.forModule('costing');
    await escaped.inventory.snapshot(202601);
    await withServiceScope(async () => {
      await expect(escaped!.inventory.snapshot(202601)).rejects.toThrow(/请求作用域/);
    });
    detached = new Promise<void>((resolve) => {
      release = resolve;
    }).then(async () => {
      await expect(escaped!.inventory.snapshot(202601)).rejects.toThrow(/请求作用域/);
    });
  });
  await expect(escaped!.inventory.snapshot(202601)).rejects.toThrow(/请求作用域/);
  release!();
  await detached;
});

it('未等待的操作在退出with前排空并强制真实事务回滚', async () => {
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  const hasStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  book = await createTestBook({
    providers: {
      inventory: (svc) => ({
        snapshot: async () => snapshot,
        with: (run) =>
          run({
            ...capability,
            lockVoucherSource: async (input) => {
              started!();
              await blocked;
              await svc.settings.set('pending-write', 'must-rollback');
              return capability.lockVoucherSource(input);
            },
          }),
      }),
    },
  });
  let operation: Promise<unknown> | undefined;
  const transaction = book.forModule('costing').tx((t) =>
    t.inventory.with(async (inv) => {
      operation = inv.lockVoucherSource({
        bookId: 'synthetic',
        documentId: 1,
        purpose: 'cost',
        expectedRevision: 1,
        voucherId: 1,
      });
      await hasStarted;
    }),
  );
  await hasStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  finish!();
  await expect(transaction).rejects.toMatchObject({
    data: { code: 'INVENTORY_OPERATION_PENDING' },
  });
  await operation;
  expect(await book.forModule('costing').settings.get('pending-write', null)).toBeNull();
});

it('整个with仍在初始化时外层抛错，排空后回滚并保留调用方原错误', async () => {
  let entered: (() => void) | undefined;
  let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  book = await createTestBook({
    providers: {
      inventory: (svc) => ({
        snapshot: async () => snapshot,
        with: async (run) => {
          entered!();
          await blocked;
          await svc.settings.set('provider-initialization', 'must-rollback');
          return run(capability);
        },
      }),
    },
  });
  let operation: Promise<unknown> | undefined;
  let probe: Promise<boolean> | undefined;
  let probeRead: (() => void) | undefined;
  let settled = false;
  const transaction = book.forModule('costing').tx(async (t) => {
    await t.settings.set('caller-before-with', 'must-rollback');
    probe = new Promise<void>((resolve) => {
      probeRead = resolve;
    }).then(async () => {
      await expect(t.inventory.snapshot(202601)).rejects.toThrow(/事务/);
      return true;
    });
    operation = t.inventory.with(async () => undefined);
    void operation.catch(() => undefined);
    throw new Error('调用方原错误');
  });
  const completed = transaction.catch((error: unknown) => {
    settled = true;
    return error;
  });
  await started;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const settledBeforeRelease = settled;
  probeRead!();
  const readExpired = await probe!.catch(() => false);
  release!();
  const error = await completed;
  await operation;
  expect(settledBeforeRelease).toBe(false);
  expect(readExpired).toBe(true);
  expect(error).toMatchObject({ message: '调用方原错误' });
  expect(await book.forModule('costing').settings.get('caller-before-with', null)).toBeNull();
  expect(await book.forModule('costing').settings.get('provider-initialization', null)).toBeNull();
});

it('捕获已完成with的异常仍须回滚，不能通过吞掉回调错误提交部分写入', async () => {
  book = await createTestBook({
    providers: {
      inventory: () => ({ snapshot: async () => snapshot, with: (run) => run(capability) }),
    },
  });
  await expect(
    book.forModule('costing').tx(async (t) => {
      await t.settings.set('caller-before-failed-with', 'must-rollback');
      await t.inventory
        .with(async () => {
          await t.settings.set('inside-failed-with', 'must-rollback');
          throw new Error('库存回调失败');
        })
        .catch(() => undefined);
    }),
  ).rejects.toThrow('库存回调失败');
  expect(await book.forModule('costing').settings.get('caller-before-failed-with', null)).toBeNull();
  expect(await book.forModule('costing').settings.get('inside-failed-with', null)).toBeNull();
});
it('普通嵌套tx捕获错误的既有语义保持，不将所有嵌套事务一律标成桥失败', async () => {
  book = await createTestBook();
  await book.forModule('costing').tx(async (t) => {
    await t.settings.set('ordinary-outer', 'kept');
    await t
      .tx(async (u) => {
        await u.settings.set('ordinary-inner', 'kept');
        throw new Error('普通嵌套错误');
      })
      .catch(() => undefined);
  });
  expect(await book.forModule('costing').settings.get('ordinary-outer', null)).toBe('kept');
  expect(await book.forModule('costing').settings.get('ordinary-inner', null)).toBe('kept');
});
