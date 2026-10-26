/** 产品形态。一个程序，三种形态只决定显示哪些模块。 */
export const PRODUCTS = [
  { id: 'qingsong', name: '轻松会计', description: '账务 + 出纳 + 发票' },
  { id: 'minfei', name: '民非企会计', description: '账务 + 工资 + 固定资产 + 出纳' },
  { id: 'chengben', name: '成本会计', description: '全部模块' },
] as const;

export type ProductId = (typeof PRODUCTS)[number]['id'];

export const PRODUCT_IDS = PRODUCTS.map((p) => p.id) as [ProductId, ...ProductId[]];

export function productName(id: ProductId): string {
  return PRODUCTS.find((p) => p.id === id)?.name ?? id;
}
