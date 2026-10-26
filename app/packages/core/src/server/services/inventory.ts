import { AsyncLocalStorage } from 'node:async_hooks';
import { isInDatabaseTransaction } from '@caiwu/db';
import { BusinessError } from '../../errors';
import { nextPeriod, periodEndDate } from '../../period';
import type {
  InventoryCostingCapability,
  InventoryService,
  InventorySnapshot,
  CostingCommitInput,
  CostingCancelInput,
  VoucherSourceInput,
} from '../../inventory';
import { assertServiceScope } from '../service-scope';
import type { CoreServices } from './index';

const transactions = new AsyncLocalStorage<{ svc: CoreServices; active: boolean }>();
const callbacks = new AsyncLocalStorage<object>();

export function withCoreServiceTransaction<T>(
  svc: CoreServices,
  run: () => Promise<T>,
): Promise<T> {
  const scope = { svc, active: true };
  return transactions.run(scope, async () => {
    try {
      return await run();
    } finally {
      scope.active = false;
    }
  });
}

function fail(code: string, message: string, hint: string): never {
  throw new BusinessError({ code, message, hint });
}

/** 事务服务不可在旧回调结束后通过再次 tx 复活。 */
export function assertCoreServiceTransaction(svc: CoreServices): void {
  const current = transactions.getStore();
  if (
    svc.db.isTransaction &&
    (!current?.active || current.svc !== svc || !isInDatabaseTransaction())
  )
    fail(
      'INVENTORY_SCOPE_EXPIRED',
      '事务服务不属于当前回调或事务已结束',
      '请使用当前 svc.tx 回调传入的服务',
    );
}

/** 只核对正式批次的承接关系；不计算或修补库存成本。 */
function assertHistory(snapshot: InventorySnapshot): void {
  const active = snapshot.batches.filter((batch) => batch.status === 'calculated');
  const control = snapshot.control;
  const invalid = () =>
    fail(
      'INVENTORY_HISTORY_INVALID',
      '库存正式批次链与控制锚点不一致',
      '请核对正式历史批次，不能补零或跳过缺失月份',
    );
  if (control.costBatch === null) {
    if (active.length || control.costPeriod !== null || control.costCutoffDate !== null) invalid();
    return;
  }
  const byId = new Map(active.map((batch) => [batch.id, batch]));
  let batch = byId.get(control.costBatch);
  if (
    !batch ||
    batch.period !== control.costPeriod ||
    control.costCutoffDate !== periodEndDate(batch.period)
  )
    invalid();
  const seen = new Set<string>();
  while (batch) {
    if (seen.has(batch.id)) invalid();
    seen.add(batch.id);
    if (batch.previous_batch_id === null) {
      if (batch.period !== snapshot.startPeriod) invalid();
      break;
    }
    const previous = byId.get(batch.previous_batch_id);
    if (!previous || nextPeriod(previous.period) !== batch.period) invalid();
    batch = previous;
  }
  if (seen.size !== active.length) invalid();
}

export function inventoryService(svc: CoreServices): InventoryService {
  const transaction = transactions.getStore();
  const assertBound = () => {
    assertServiceScope(svc.ctx.scope);
    assertCoreServiceTransaction(svc);
    if (svc.moduleId !== 'costing' && svc.moduleId !== 'inventory')
      fail('COST_OWNER', '库存核算只能由库存或成本模块调用', '请从库存或成本功能重新操作');
    if (
      svc.db.isTransaction &&
      (!transaction?.active || transactions.getStore() !== transaction || transaction.svc !== svc)
    )
      fail(
        'INVENTORY_SCOPE_EXPIRED',
        '库存能力不属于当前事务或事务回调已结束',
        '请使用当前 svc.tx 回调传入的服务',
      );
    if (!svc.db.isTransaction && transactions.getStore()?.active)
      fail(
        'TRANSACTION_REQUIRED',
        '事务内使用了事务外的库存服务',
        '请使用当前 svc.tx 回调传入的服务',
      );
  };
  const provider = () => {
    assertBound();
    const factory = svc.ctx.providers?.inventory;
    if (!factory)
      fail(
        'INVENTORY_PROVIDER_MISSING',
        '当前运行环境未注册库存成本服务',
        '请启用库存模块后重新操作',
      );
    return factory(svc);
  };
  return Object.freeze({
    async snapshot(period: number) {
      const result = await provider().snapshot(period);
      assertBound();
      return result;
    },
    async with<T>(run: (inventory: InventoryCostingCapability) => Promise<T>): Promise<T> {
      assertBound();
      if (!svc.db.isTransaction || !isInDatabaseTransaction())
        fail(
          'TRANSACTION_REQUIRED',
          '写库存成本必须在 svc.tx 回调内执行',
          '请调用 svc.tx(t => t.inventory.with(...))',
        );
      return provider().with(async (inventory) => {
        const callback = {};
        return callbacks.run(callback, async () => {
          let active = true;
          const pending = new Set<Promise<unknown>>();
          const guard =
            <A extends unknown[], R>(method: (...args: A) => Promise<R>) =>
            async (...args: A): Promise<R> => {
              assertBound();
              if (!active || callbacks.getStore() !== callback)
                fail(
                  'INVENTORY_SCOPE_EXPIRED',
                  '库存能力的回调作用域已结束',
                  '请在当前 inventory.with 回调内完成操作',
                );
              const result = method(...args);
              pending.add(result);
              try {
                return await result;
              } finally {
                pending.delete(result);
              }
            };
          const capability: InventoryCostingCapability = Object.freeze({
            snapshot: guard((period: number) => inventory.snapshot(period)),
            commitCosting: guard(async (input: CostingCommitInput) => {
              assertHistory(await inventory.snapshot(input.period));
              return inventory.commitCosting(input);
            }),
            cancelCosting: guard(async (input: CostingCancelInput) => {
              // snapshot 的期间仅用于读取完整批次链，不替代库存工厂的期间/状态检查。
              const period =
                (await svc.periods.current())?.period ?? (await svc.book.info()).startPeriod;
              assertHistory(await inventory.snapshot(period));
              return inventory.cancelCosting(input);
            }),
            lockVoucherSource: guard((input: VoucherSourceInput) =>
              inventory.lockVoucherSource(input),
            ),
            releaseVoucherSource: guard((input: VoucherSourceInput) =>
              inventory.releaseVoucherSource(input),
            ),
          });
          try {
            const result = await run(capability);
            assertBound();
            if (pending.size)
              fail(
                'INVENTORY_OPERATION_PENDING',
                '库存回调结束时仍有未等待的操作',
                '请在回调内 await 每个库存操作',
              );
            return result;
          } finally {
            active = false;
            // 先排空已启动的操作再让外层事务提交或回滚，避免操作逃逸到已结束事务。
            await Promise.allSettled([...pending]);
          }
        });
      });
    },
  });
}
