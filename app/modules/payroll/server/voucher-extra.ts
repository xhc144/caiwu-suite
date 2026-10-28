import { DIMENSION_TYPES, dimensionsKey, type VoucherLineInput } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { VoucherMapping } from '../shared-voucher';
import { fail, sum } from './engine';

export async function validateVoucherAuxiliaries(svc: CoreServices, mapping: VoucherMapping) {
  const seen = new Set<string>();
  for (const auxiliary of mapping.auxiliaries) {
    const key = `${auxiliary.accountId}:${auxiliary.employeeId ?? 'all'}`;
    if (seen.has(key)) fail('MAPPING_AUXILIARY_DUPLICATE', '同科目及人员不能重复配置辅助核算');
    seen.add(key);
    const account = await svc.accounts.require(auxiliary.accountId);
    if (!account.isLeaf || account.disabled) fail('NOT_LEAF', '辅助核算科目须为启用的末级科目');
    if (auxiliary.employeeId) {
      const employee = await svc.db
        .withTables<{ payroll_employee: { id: number } }>()
        .selectFrom('payroll_employee')
        .select('id')
        .where('id', '=', auxiliary.employeeId)
        .executeTakeFirst();
      if (!employee) fail('MAPPING_EMPLOYEE', '辅助核算配置中的工资人员不存在');
    }
    for (const type of DIMENSION_TYPES) {
      const id = auxiliary.values[type.id];
      if (id == null) continue;
      if (type.id !== 'cashflow' && !account.dimensions.some((d) => d.type === type.id))
        fail('MAPPING_AUXILIARY_TYPE', `科目 ${account.code} 未启用${type.name}核算`);
      const item = await svc.dimensions.get(id);
      if (!item || item.typeId !== type.id || item.disabled || !item.isLeaf)
        fail('MAPPING_AUXILIARY', `${type.name}须选择启用的末级档案`, '刷新辅助档案后重新选择');
    }
  }
}

/** 超过凭证上限时合并同科目、全部辅助、方向及金额符号；红字不与蓝字抵消。 */
export function aggregatePayrollLines(lines: VoucherLineInput[], summary: string) {
  if (lines.length <= 999) return { lines, originalLineCount: lines.length, aggregated: false };
  const groups = new Map<string, VoucherLineInput>();
  for (const line of lines) {
    const side = line.debit ? 'debit' : 'credit';
    const amount = line[side] ?? 0;
    const key = JSON.stringify([
      line.accountId,
      dimensionsKey(line.dimensions ?? {}),
      side,
      Math.sign(amount),
      line.cashflowDirection ?? null,
    ]);
    const previous = groups.get(key);
    if (previous) previous[side] = sum([previous[side] ?? 0, amount]);
    else groups.set(key, { ...line, summary });
  }
  return { lines: [...groups.values()], originalLineCount: lines.length, aggregated: true };
}
