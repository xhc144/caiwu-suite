import { zPeriod } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { fail } from './engine';

/** 初始化前保留的工资只作历史及累计来源，普通修改和处理不得越过工资启用边界。 */
export async function assertPayrollStart(svc: CoreServices, period: number): Promise<void> {
  const book = await svc.book.info();
  const saved = await svc.settings.get<unknown>('initializedStartPeriod', book.startPeriod);
  const configured = zPeriod.safeParse(saved);
  if (!configured.success)
    fail('START_PERIOD', '工资启用期间设置无效', '请由管理员核对工资初始化设置');
  if (period < Math.max(book.startPeriod, configured.data))
    fail(
      'START_PERIOD',
      '工资期间早于启用期间（工资模块）',
      '选择工资启用期间及以后的期间；此前工资可查询和参与累计',
    );
}
