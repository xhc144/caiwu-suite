import { BusinessError } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { fail } from './engine';

/** 宿主旧规则把工资结账自身作为business阻止项；取消工资结账仍须复核真实会计期间、年度及其他模块依赖。 */
export async function assertReopenPeriodOpen(svc: CoreServices, period: number) {
  const book = await svc.book.info(),
    current = await svc.periods.require(period);
  if (period < book.startPeriod)
    fail('START_PERIOD', '工资期间早于启用期间', '只处理启用后最近的已结工资');
  if (current.status !== 'open')
    fail('PERIOD_CLOSED', '会计期间已经结账，不能反结工资', '先按账务权限处理会计期间');
  const year = (await svc.periods.years()).find(
    (candidate) => candidate.year === Math.trunc(period / 100),
  );
  if (!year || year.status !== 'open')
    fail('YEAR_CLOSED', '会计年度未建立或已经年结，不能反结工资', '先按账务权限处理会计年度');
  const blocks = (
    await svc.periods.dependencies({ period, mode: 'business', action: '工资反结账' })
  ).filter((block) => block.category !== '工资已结账批次');
  if (blocks.length)
    throw new BusinessError({
      code: 'PAYROLL_PERIOD_DEPENDENCIES',
      message: `工资反结账仍有未处理事项：${blocks.map((block) => `${block.category}${block.count}项`).join('、')}`,
      hint: '先处理所列事项，再重新预览',
      actions: blocks.flatMap((block) =>
        block.to ? [{ label: `处理${block.category}`, to: block.to }] : [],
      ),
    });
}
