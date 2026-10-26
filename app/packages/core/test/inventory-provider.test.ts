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
