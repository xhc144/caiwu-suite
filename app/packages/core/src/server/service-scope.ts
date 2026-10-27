import { AsyncLocalStorage } from 'node:async_hooks';
import { BusinessError } from '../errors';

export interface ServiceScope {
  active: boolean;
}
const requests = new AsyncLocalStorage<ServiceScope>();

/** 为一个已认证请求建立能力有效期；子事务继承同一请求。 */
export function withServiceScope<T>(run: () => Promise<T>): Promise<T> {
  const scope = { active: true };
  return requests.run(scope, async () => {
    try {
      return await run();
    } finally {
      scope.active = false;
    }
  });
}

export function currentServiceScope(): ServiceScope | undefined {
  return requests.getStore();
}

export function assertServiceScope(scope: ServiceScope | undefined): void {
  if (scope && (!scope.active || requests.getStore() !== scope))
    throw new BusinessError({
      code: 'INVENTORY_SCOPE_EXPIRED',
      message: '库存能力的请求作用域已结束或不属于当前请求',
      hint: '请在当前请求中重新获取服务，不要保存或跨请求复用库存能力',
    });
}
