import type { z } from 'zod';
import type { QueryConditionSchema, SalaryRow } from '../shared';
import { GroupedSalaryQuerySchema, type GroupedSalaryQuery } from '../shared-query';

type QueryRow = SalaryRow & { period: number; batchId: number };
export function matchesCondition(row: SalaryRow, condition: z.output<typeof QueryConditionSchema>) {
  if (
    condition.field === 'code' ||
    condition.field === 'name' ||
    condition.field === 'department'
  ) {
    const actual =
      condition.field === 'department'
        ? row.employee.departmentName
        : row.employee[condition.field];
    return condition.operator === 'equals'
      ? actual === condition.value
      : condition.operator === 'contains'
        ? actual.includes(condition.value)
        : !actual.includes(condition.value);
  }
  const actual = condition.field === 'startDate' ? row.employee.startDate : row[condition.field];
  switch (condition.operator) {
    case 'equals':
      return actual === condition.value;
    case 'gt':
      return actual > condition.value;
    case 'gte':
      return actual >= condition.value;
    case 'lt':
      return actual < condition.value;
    case 'lte':
      return actual <= condition.value;
  }
}
export function filterSalaryRows(rows: QueryRow[], raw: z.input<typeof GroupedSalaryQuerySchema>) {
  const query = GroupedSalaryQuerySchema.parse(raw);
  const selected = rows.filter(
    (row) =>
      query.conditions.every((condition) => matchesCondition(row, condition)) &&
      (query.groups.length === 0 ||
        (query.groupMode === 'all'
          ? query.groups.every((group) => matchesGroup(row, group))
          : query.groups.some((group) => matchesGroup(row, group)))),
  );
  return selected.sort((a, b) => {
    for (const sort of query.sorts) {
      const left = sortValue(a, sort.field),
        right = sortValue(b, sort.field);
      const result =
        typeof left === 'number' && typeof right === 'number'
          ? left < right
            ? -1
            : left > right
              ? 1
              : 0
          : String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
      if (result) return sort.direction === 'asc' ? result : -result;
    }
    return a.period - b.period || a.batchId - b.batchId || a.employeeId - b.employeeId;
  });
}
function matchesGroup(row: SalaryRow, group: GroupedSalaryQuery['groups'][number]) {
  return group.mode === 'all'
    ? group.conditions.every((condition) => matchesCondition(row, condition))
    : group.conditions.some((condition) => matchesCondition(row, condition));
}
function sortValue(row: QueryRow, field: GroupedSalaryQuery['sorts'][number]['field']) {
  if (field === 'department') return row.employee.departmentName;
  if (field === 'code' || field === 'name' || field === 'startDate') return row.employee[field];
  return row[field];
}
