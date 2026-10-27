import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CONDITIONS, type QueryCondition } from '../shared';
import {
  queryDefaults,
  queryToFilters,
  queryUrlDefaults,
  readQueryFilters,
  validateQuery,
} from '../web/query-filters';

const conditions: QueryCondition[] = [
  { field: 'name', op: 'contains', value: '服务器' },
  { field: 'amount', op: 'gt', value: '10000' },
  { field: 'useDate', op: 'lt', value: '2026-02-01' },
];

describe('w_zjgl_cx：页面与地址筛选契约', () => {
  it('多条件及全部基础筛选可无损保存到 URL 并恢复，默认查询没有综合条件', () => {
    const defaults = queryDefaults(2026);
    expect(readQueryFilters(queryUrlDefaults(2026)).input).toEqual(defaults);
    expect(
      validateQuery({
        ...defaults,
        conditions: Array.from({ length: MAX_QUERY_CONDITIONS }, () => conditions[0]),
      }).error,
    ).toBeNull();
    const input = {
      ...defaults,
      from: 202602,
      to: 202603,
      showZero: true,
      assetId: 3,
      departmentId: 1,
      categoryId: 2,
      purposeId: 4,
      departmentLevel: 'top' as const,
      categoryLevel: 'top' as const,
      conditions,
    };
    expect(readQueryFilters(queryToFilters(input))).toEqual({ input, error: null });
  });

  it('保留旧四字段单条件链接，条件数组优先且不会叠加旧值', () => {
    const legacy = { ...queryUrlDefaults(2026), field: 'name', op: 'contains', value: '服务器' };
    expect(readQueryFilters(legacy).input?.conditions).toEqual([conditions[0]]);
    expect(readQueryFilters({ ...legacy, conditions: '[]' }).input?.conditions).toEqual([]);
  });
  it('档案筛选 NaN 或负数不会当作未选择而被忽略', () => {
    for (const assetId of [NaN, -1])
      expect(readQueryFilters({ ...queryUrlDefaults(2026), assetId }).input).toBeNull();
  });

  it.each([
    ['坏 JSON', '{'],
    ['错误结构', '{}'],
    ['未知字段', JSON.stringify([{ field: 'sql', op: 'eq', value: '1' }])],
    ['未知操作符', JSON.stringify([{ field: 'name', op: 'or', value: '1' }])],
    ['隐藏逻辑', JSON.stringify([{ ...conditions[0], logical: 'or' }])],
    [
      '超过预算',
      JSON.stringify(Array.from({ length: MAX_QUERY_CONDITIONS + 1 }, () => conditions[0])),
    ],
  ])('%s 明确失败，不会回退成不带条件的查询', (_label, raw) => {
    const result = readQueryFilters({ ...queryUrlDefaults(2026), conditions: raw });
    expect(result.input).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it.each([
    [{ field: 'amount', op: 'contains', value: '1' }, '金额不能使用「含有」操作符'],
    [{ field: 'useDate', op: 'contains', value: '2026' }, '日期不能使用「含有」操作符'],
    [{ field: 'amount', op: 'eq', value: '1.01' }, '整数分'],
    [{ field: 'amount', op: 'gt', value: '9007199254740992' }, '整数分'],
    [{ field: 'useDate', op: 'lt', value: '2026-02-30' }, 'YYYY-MM-DD'],
    [{ field: 'name', op: 'eq', value: '  ' }, '不能为空'],
  ])('坏的第二条条件不会被忽略：%j', (bad, message) => {
    const result = validateQuery({ ...queryDefaults(2026), conditions: [conditions[0], bad] });
    expect(result.input).toBeNull();
    expect(result.error).toContain(`第 2 条条件：`);
    expect(result.error).toContain(message);
  });

  it('空值、倒置期间、未知分组及额外逻辑拒绝；合法零金额和闰日接受', () => {
    for (const bad of [
      { conditions: [{ field: 'code', op: 'eq', value: '' }] },
      { from: 202613 },
      { from: 202612, to: 202601 },
      { departmentLevel: 'unknown' },
      { logical: 'or' },
    ])
      expect(validateQuery({ ...queryDefaults(2026), ...bad }).input).toBeNull();
    expect(
      validateQuery({
        ...queryDefaults(2026),
        conditions: [
          { field: 'amount', op: 'eq', value: '0' },
          { field: 'useDate', op: 'gt', value: '2024-02-29' },
        ],
      }).error,
    ).toBeNull();
  });
});
