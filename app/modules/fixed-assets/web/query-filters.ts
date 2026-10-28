import type { z } from 'zod';
import { QuerySchema, queryConditionProblem } from '../shared';
import { parseQueryLogic } from '../query-logic';

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
    displayColumns: JSON.stringify(queryDefaults(year).displayColumns),
    sorts: '',
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
    } else if (key === 'sorts' || key === 'sortField' || key === 'sortDirection') {
      error = '排序条件不正确：最多五个字段，字段不能重复，请选择升序或降序';
    } else if (key === 'displayColumns') {
      error = '请至少选择一个显示列，列名不能重复';
    } else if (key === 'expression') {
      error = '条件组合不能超过 500 字，请检查条件编号及括号';
    } else if (key === 'from' || key === 'to' || issue.code === 'custom') {
      error = '请填写有效的起止月份（YYYYMM），起始月份不能晚于截止月份';
    }
    return { input: null, error };
  }
  for (const [index, condition] of parsed.data.conditions.entries()) {
    const problem = queryConditionProblem(condition);
    if (problem) return { input: null, error: `第 ${index + 1} 条条件：${problem.message}` };
  }
  try {
    parseQueryLogic(parsed.data.expression, parsed.data.conditions.length);
  } catch (e) {
    return { input: null, error: e instanceof Error ? e.message : '组合表达式不正确' };
  }
  return { input: parsed.data, error: null };
}

/** 兼容旧 field/op/value 链接。JSON 格式错误不会退回无条件查询。 */
export function readQueryFilters(f: ReturnType<typeof queryUrlDefaults>) {
  let conditions: unknown;
  let columns: unknown;
  let sorts: unknown;
  try {
    columns = JSON.parse(f.displayColumns);
    sorts = f.sorts ? JSON.parse(f.sorts) : [];
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
    expression: f.expression,
    displayColumns: columns,
    sortField: f.sortField,
    sortDirection: f.sortDirection,
    hideRepeated: f.hideRepeated,
    sorts,
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
    displayColumns: JSON.stringify(input.displayColumns),
    sorts: JSON.stringify(input.sorts),
    field: 'code',
    op: 'eq',
    value: '',
  };
}
