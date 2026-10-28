import { BusinessError, Decimal, type BalanceRow, type DimensionItem } from '@caiwu/core';

/** 使用档案的 parentId，不从编码长度猜测辅助层级。 */
export function dimensionAncestors(
  id: number,
  items: DimensionItem[],
  byId = new Map(items.map((item) => [item.id, item])),
): DimensionItem[] {
  const path: DimensionItem[] = [];
  const seen = new Set<number>();
  let item = byId.get(id);
  while (item) {
    if (seen.has(item.id))
      throw new BusinessError({
        code: 'BALANCES_DIMENSION_CYCLE',
        message: '辅助档案的上下级关系存在循环，无法汇总',
        hint: '请先在基础档案中修正上下级关系',
      });
    seen.add(item.id);
    path.unshift(item);
    item = item.parentId == null ? undefined : byId.get(item.parentId);
  }
  return path;
}

/** 同一科目下互不重复的辅助分项合并，金额逐分相加、数量按十进制相加。 */
export function mergeAuxiliaryRows(rows: BalanceRow[]): BalanceRow[] {
  const result = new Map<number, BalanceRow>();
  for (const row of rows) {
    const old = result.get(row.accountId);
    if (!old) {
      result.set(row.accountId, { ...row, dimensions: { ...row.dimensions } });
      continue;
    }
    for (const key of [
      'opening',
      'debit',
      'credit',
      'closing',
      'ytdDebit',
      'ytdCredit',
      'fcOpening',
      'fcDebit',
      'fcCredit',
      'fcClosing',
      'fcYtdDebit',
      'fcYtdCredit',
    ] as const) {
      const a = old[key],
        b = row[key];
      if (a == null || b == null) {
        if (key === 'fcYtdDebit' || key === 'fcYtdCredit') old[key] = null;
        continue;
      }
      const sum = Number(BigInt(a) + BigInt(b));
      if (!Number.isSafeInteger(sum))
        throw new BusinessError({
          code: 'BALANCES_AMOUNT_OVERFLOW',
          message: '辅助余额合计超出安全范围',
          hint: '请缩小辅助项或科目范围后重试',
        });
      old[key] = sum;
    }
    for (const key of ['qtyOpening', 'qtyDebit', 'qtyCredit', 'qtyClosing'] as const)
      old[key] = new Decimal(old[key]).add(row[key]).toFixed();
    for (const key of ['qtyYtdDebit', 'qtyYtdCredit'] as const)
      old[key] =
        old[key] == null || row[key] == null ? null : new Decimal(old[key]).add(row[key]).toFixed();
    old.dimensionYtdMissing ||= row.dimensionYtdMissing;
  }
  return [...result.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}
