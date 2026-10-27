import type { z } from 'zod';
import { QuerySchema, queryConditionProblem } from '../shared';

export type QueryValues = z.output<typeof QuerySchema>;
export type QueryDraft = z.input<typeof QuerySchema>;

export function queryDefaults(year: number): QueryValues {
  return QuerySchema.parse({ from: year * 100 + 1, to: year * 100 + 12 });
}

export function queryUrlDefaults(year: number) {
  return {
    ...queryDefaults(year),
    assetId: 0,
    departmentId: 0,
    categoryId: 0,
    purposeId: 0,
    conditions: '',
    field: 'code',
    op: 'eq',
    value: '',
  };
}

export function validateQuery(
  value: unknown,
): { input: QueryValues; error: null } | { input: null; error: string } {
  const parsed = QuerySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const [key, index, part] = issue.path;
    let error = '筛选格式不正确，请检查月份、档案及分组条件';
    if (key === 'conditions') {
      const label = typeof index === 'number' ? `第 ${index + 1} 条条件：` : '';
      error =
        label +
        (part === 'field'
          ? '不支持的字段，请重新选择'
          : part === 'op'
            ? '不支持的操作符，请重新选择'
            : part === 'value'
              ? '条件值不能为空且不能超过 500 字'
              : '条件格式不正确，最多 20 条，仅支持字段、操作符和值的交集');
    } else if (key === 'from' || key === 'to' || issue.code === 'custom') {
      error = '请填写有效的起止月份（YYYYMM），起始月份不能晚于截止月份';
    }
    return { input: null, error };
  }
  for (const [index, condition] of parsed.data.conditions.entries()) {
    const problem = queryConditionProblem(condition);
    if (problem) return { input: null, error: `第 ${index + 1} 条条件：${problem.message}` };
  }
  return { input: parsed.data, error: null };
}

/** 兼容旧 field/op/value 链接。JSON 格式错误不会退回无条件查询。 */
export function readQueryFilters(f: ReturnType<typeof queryUrlDefaults>) {
  let conditions: unknown;
  try {
    conditions = f.conditions
      ? JSON.parse(f.conditions)
      : f.value || f.field !== 'code' || f.op !== 'eq'
        ? [{ field: f.field, op: f.op, value: f.value }]
        : [];
  } catch {
    return { input: null, error: '综合条件格式损坏，请重新编辑或清除筛选' } as const;
  }
  return validateQuery({
    from: f.from,
    to: f.to,
    showZero: f.showZero,
    assetId: f.assetId === 0 ? undefined : f.assetId,
    departmentId: f.departmentId === 0 ? undefined : f.departmentId,
    categoryId: f.categoryId === 0 ? undefined : f.categoryId,
    purposeId: f.purposeId === 0 ? undefined : f.purposeId,
    conditions,
    departmentLevel: f.departmentLevel,
    categoryLevel: f.categoryLevel,
  });
}

export function queryToFilters(input: QueryValues) {
  return {
    ...input,
    assetId: input.assetId ?? 0,
    departmentId: input.departmentId ?? 0,
    categoryId: input.categoryId ?? 0,
    purposeId: input.purposeId ?? 0,
    conditions: JSON.stringify(input.conditions),
    field: 'code',
    op: 'eq',
    value: '',
  };
}
