import { BusinessError, type Account } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { requiresCashflow, type Cashflows } from '../shared';

const labels = { in: '流入', out: '流出' } as const;
function invalid(code: string, message: string): never {
  throw new BusinessError({
    code: `PERIOD_CLOSE_CASHFLOW_${code}`,
    message,
    hint: '在本模块结转设置中按流入、流出明确选择现金流量项目，再重新预览；不会沿用历史凭证的项目来猜测反向分录',
    actions: [{ label: '修改结转设置', to: '/m/period-close' }],
  });
}
/** 这是结转生成规则，不修改 core 或凭证审核中“缺项目可确认继续”的政策。 */
export async function validateCashflows(
  svc: CoreServices,
  account: Account,
  choices: Cashflows | undefined,
  role: string,
) {
  if (requiresCashflow(account) && !choices?.in && !choices?.out)
    invalid(
      'REQUIRED',
      `${role}科目 ${account.code} ${account.name} 需要明确现金流量项目及流入/流出方向`,
    );
  for (const direction of ['in', 'out'] as const) {
    const id = choices?.[direction];
    if (id == null) continue;
    const item = await svc.dimensions.get(id);
    if (!item || item.typeId !== 'cashflow' || !item.isLeaf || item.disabled)
      invalid(
        'ITEM',
        `${role}科目 ${account.code} 的${labels[direction]}项目无效、已停用或不是末级`,
      );
    // attrs 是扩展数据：只有明确的 in/out 可以核对，未知声明不能当成已核验。
    const declared = item.attrs.direction;
    if (declared != null && declared !== '' && declared !== 'in' && declared !== 'out')
      invalid('UNKNOWN_DIRECTION', `现金流量项目 ${item.code} 的方向声明无法识别，不能宣称已核验`);
    if ((declared === 'in' || declared === 'out') && declared !== direction)
      invalid(
        'DIRECTION',
        `现金流量项目 ${item.code} 已声明${labels[declared]}，不能用于${labels[direction]}`,
      );
  }
}
export function cashflowForLine(
  account: Account,
  choices: Cashflows | undefined,
  signedAmount: number,
  role: string,
) {
  const direction = signedAmount > 0 ? 'in' : 'out';
  const id = choices?.[direction] ?? null;
  if ((requiresCashflow(account) || choices) && id == null)
    invalid(
      'REQUIRED',
      `${role}科目 ${account.code} 本次实际为现金${labels[direction]}，尚未选择对应项目`,
    );
  return id;
}
