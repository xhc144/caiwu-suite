import { BusinessError, type Account, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { CashflowDirectionSchema, requiresCashflow, type Cashflows } from '../shared';
import { sumMoney } from './amounts';

const labels = { in: '流入', out: '流出' } as const;
function invalid(code: string, message: string): never {
  throw new BusinessError({
    code: `PERIOD_CLOSE_CASHFLOW_${code}`,
    message,
    hint: '先在基础档案维护或新建方向明确的现金流量项目，再在结转设置选择对应项目；历史缺失或未知方向不能由手选位置、旧字段或名称代替',
    actions: [{ label: '修改结转设置', to: '/m/period-close' }],
  });
}
async function cashflowItem(svc: CoreServices, id: number, account: Account, role: string) {
  const item = await svc.dimensions.get(id);
  if (!item || item.typeId !== 'cashflow' || !item.isLeaf || item.disabled)
    invalid('ITEM', `${role}科目 ${account.code} 的现金流量项目无效、已停用或不是末级`);
  // M03 的唯一持久化方向约定。旧 attrs.direction 不作为回退来源。
  const parsed = CashflowDirectionSchema.safeParse(item.attrs.cashflowDirection);
  if (!parsed.success)
    invalid(
      'UNKNOWN_DIRECTION',
      `现金流量项目 ${item.code} 方向未配置或无法识别，不能生成结转凭证`,
    );
  return { item, direction: parsed.data };
}
/** 这是 M07 生成前置，不修改 core/M06 对手工凭证的确认政策。 */
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
  if (!account.cashflowRequired && (choices?.in || choices?.out))
    invalid('NOT_ENABLED', `${role}科目 ${account.code} 未启用现金流量核算，不能填写现金流量项目`);
  for (const direction of ['in', 'out'] as const) {
    const id = choices?.[direction];
    if (id == null) continue;
    const declared = await cashflowItem(svc, id, account, role);
    const expected = direction === 'in' ? 'inflow' : 'outflow';
    if (declared.direction !== 'internal' && declared.direction !== expected)
      invalid(
        'DIRECTION',
        `现金流量项目 ${declared.item.code} 已声明${declared.direction === 'inflow' ? '流入' : '流出'}，不能用于${labels[direction]}`,
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
/** 与 M05 一样按每张凭证核对内部现金流净额；不能跨结转凭证互相抵销。 */
export async function validateGeneratedCashflows(
  svc: CoreServices,
  lines: readonly VoucherLineInput[],
  accounts: readonly Account[],
) {
  const internal: number[] = [];
  const checked: { line: number; itemId: number; direction: 'inflow' | 'outflow' | 'internal' }[] =
    [];
  for (const [index, line] of lines.entries()) {
    const account = accounts.find((a) => a.id === line.accountId)!;
    const id = line.dimensions?.cashflow;
    if (!account.cashflowRequired) {
      if (id != null)
        invalid('NOT_ENABLED', `科目 ${account.code} 未启用现金流量核算，不能作为内部现金流配平行`);
      continue;
    }
    if (id == null) invalid('REQUIRED', `科目 ${account.code} 的生成行缺少现金流量项目`);
    const declared = await cashflowItem(svc, id, account, '生成');
    line.cashflowDirection = declared.direction;
    checked.push({ line: index + 1, itemId: id, direction: declared.direction });
    const signed = sumMoney([line.debit, -(line.credit ?? 0)]);
    if (declared.direction === 'internal') internal.push(signed);
    else if (
      (declared.direction === 'inflow' && signed < 0) ||
      (declared.direction === 'outflow' && signed > 0)
    )
      invalid('DIRECTION', `现金流量项目 ${declared.item.code} 与生成行实际现金增减方向冲突`);
  }
  const difference = sumMoney(internal);
  if (difference !== 0)
    invalid(
      'INTERNAL_UNBALANCED',
      `内部现金流入流出未配平，差额 ${difference} 分；每张结转凭证必须单独配平`,
    );
  return checked;
}
