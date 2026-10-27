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

type BridgeFailure = { failed: boolean; error: unknown };

type TransactionScope = {
  svc: CoreServices;
  active: boolean;
  closing: boolean;
  pendingWith: Set<Promise<unknown>>;
  parent: TransactionScope | undefined;
  bridgeFailure: BridgeFailure;
};
const transactions = new AsyncLocalStorage<TransactionScope>();
const callbacks = new AsyncLocalStorage<{ svc: CoreServices; active: boolean }>();

export function withCoreServiceTransaction<T>(
  svc: CoreServices,
  run: () => Promise<T>,
): Promise<T> {
  const current = transactions.getStore();
  const parent = current?.active && current.svc.db === svc.db ? current : undefined;
  const scope: TransactionScope = {
    svc,
    active: true,
    closing: false,
    pendingWith: new Set(),
    parent,
    bridgeFailure: parent?.bridgeFailure ?? { failed: false, error: undefined },
  };
  return transactions.run(scope, async () => {
    try {
      const result = await run();
      scope.closing = true;
      const unfinished = scope.pendingWith.size > 0;
      if (unfinished) {
        await drainInventoryWith(scope);
        const error = new BusinessError({
          code: 'INVENTORY_WITH_PENDING',
          message: '事务回调结束时仍有未等待的库存回调，不能提交',
          hint: '请在 svc.tx 回调内 await 或 return t.inventory.with(...)',
        });
        recordBridgeFailure(scope, error);
        throw error;
      }
      if (scope.bridgeFailure.failed) throw scope.bridgeFailure.error;
      return result;
    } finally {
      scope.closing = true;
      if (scope.pendingWith.size) await drainInventoryWith(scope);
      scope.active = false;
    }
  });
}

function recordBridgeFailure(scope: TransactionScope, error: unknown): void {
  if (!scope.bridgeFailure.failed) scope.bridgeFailure.error = error;
  scope.bridgeFailure.failed = true;
}

async function drainInventoryWith(scope: TransactionScope): Promise<void> {
  while (scope.pendingWith.size) await Promise.allSettled([...scope.pendingWith]);
}

/** 登记整个 with 返回的 Promise；观察拒绝不会改变调用方await到的结果。 */
function registerInventoryWith<T>(svc: CoreServices, run: () => Promise<T>): Promise<T> {
  const current = transactions.getStore();
  const scope = current?.active && current.svc === svc ? current : undefined;
  const operation = (async () => {
    if (scope?.closing)
      fail(
        'INVENTORY_SCOPE_EXPIRED',
        '事务回调已结束，不能启动新的库存回调',
        '请在当前 svc.tx 回调内完成所有库存操作',
      );
    return run();
  })();
  if (scope) {
    // 只向同一物理连接的祖先登记后代操作；不把祖先操作复制给子scope，避免快照嵌套自等。
    const owners: TransactionScope[] = [];
    for (let owner: TransactionScope | undefined = scope; owner; owner = owner.parent) {
      owner.pendingWith.add(operation);
      owners.push(owner);
    }
    const remove = () => {
      for (const owner of owners) owner.pendingWith.delete(operation);
    };
    void operation.then(remove, (error: unknown) => {
      recordBridgeFailure(scope, error);
      remove();
    });
  }
  return operation;
}

function fail(code: string, message: string, hint: string): never {
  throw new BusinessError({ code, message, hint });
}

/** 事务服务不可在旧回调结束后通过再次 tx 复活。 */
export function assertCoreServiceTransaction(svc: CoreServices): void {
  const current = transactions.getStore();
  const callback = callbacks.getStore();
  if (
    svc.db.isTransaction &&
    (!current?.active ||
      current.svc !== svc ||
      !isInDatabaseTransaction() ||
      (current.closing && (!callback?.active || callback.svc !== svc)))
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
    with<T>(run: (inventory: InventoryCostingCapability) => Promise<T>): Promise<T> {
      return registerInventoryWith(svc, async () => {
        assertBound();
        if (!svc.db.isTransaction || !isInDatabaseTransaction())
          fail(
            'TRANSACTION_REQUIRED',
            '写库存成本必须在 svc.tx 回调内执行',
            '请调用 svc.tx(t => t.inventory.with(...))',
          );
        return provider().with(async (inventory) => {
          const callback = { svc, active: true };
          return callbacks.run(callback, async () => {
            const pending = new Set<Promise<unknown>>();
            const guard =
              <A extends unknown[], R>(method: (...args: A) => Promise<R>) =>
              async (...args: A): Promise<R> => {
                assertBound();
                if (!callback.active || callbacks.getStore() !== callback)
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
              callback.active = false;
              // 先排空已启动的操作再让外层事务提交或回滚，避免操作逃逸到已结束事务。
              await Promise.allSettled([...pending]);
            }
          });
        });
      });
    },
  });
}
