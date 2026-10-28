import type { CoreServices } from '@caiwu/core/server';
import { fail } from './math';

export function requireCostingOwner(svc: CoreServices) {
  if (svc.moduleId !== 'costing')
    fail('OWNER', '成本业务必须从成本核算功能处理', '请返回成本核算入口重新操作');
}
