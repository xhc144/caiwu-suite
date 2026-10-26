/**
 * 辅助核算维度。对应原版科目上的 项目/客户/部门/个人 标志（xms/dws/bms/grs）以及现金流量项目。
 * 维度项存在 dimension_item 表；凭证分录、期初余额上各有一列（column）。
 */
export const DIMENSION_TYPES = [
  { id: 'project', name: '项目', column: 'dim_project', inOpening: true },
  { id: 'partner', name: '客户/供应商', column: 'dim_partner', inOpening: true },
  { id: 'department', name: '部门', column: 'dim_department', inOpening: true },
  { id: 'person', name: '个人', column: 'dim_person', inOpening: true },
  { id: 'cashflow', name: '现金流量项目', column: 'dim_cashflow', inOpening: false },
] as const;

export type DimensionTypeId = (typeof DIMENSION_TYPES)[number]['id'];
export type DimensionColumn = (typeof DIMENSION_TYPES)[number]['column'];

export const DIMENSION_TYPE_IDS = DIMENSION_TYPES.map((d) => d.id) as [
  DimensionTypeId,
  ...DimensionTypeId[],
];

/** 期初余额上也记录的维度（现金流量项目不进期初）。 */
export const OPENING_DIMENSION_TYPES = DIMENSION_TYPES.filter((d) => d.inOpening);

/** 一行分录（或一条期初）上各维度的取值：维度项 id，没有就是 null/缺省。 */
export type DimensionValues = Partial<Record<DimensionTypeId, number | null>>;

export function dimensionColumn(type: DimensionTypeId): DimensionColumn {
  const d = DIMENSION_TYPES.find((t) => t.id === type);
  if (!d) throw new RangeError(`未知的辅助核算维度：${type}`);
  return d.column;
}

export function dimensionName(type: DimensionTypeId): string {
  return DIMENSION_TYPES.find((t) => t.id === type)?.name ?? type;
}

/** 维度组合的规范化键，用于期初余额唯一性等："department=3;project=12"。空组合为 ""。 */
export function dimensionsKey(values: DimensionValues): string {
  return DIMENSION_TYPE_IDS.filter((t) => values[t] != null)
    .map((t) => `${t}=${values[t]}`)
    .join(';');
}
