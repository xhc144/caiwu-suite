/**
 * 左侧导航的固定分组。模块的菜单项必须挂在其中一个分组下，顺序由 order 决定。
 * 需要新分组时改这里（共享层），模块任务里不要改。
 */
export const MENU_GROUPS = [
  { id: 'voucher', title: '凭证', order: 10 },
  { id: 'ledger', title: '账簿', order: 20 },
  { id: 'report', title: '报表', order: 30 },
  { id: 'period', title: '期末处理', order: 40 },
  { id: 'cashier', title: '出纳', order: 50 },
  { id: 'invoice', title: '发票', order: 60 },
  { id: 'payroll', title: '工资', order: 70 },
  { id: 'asset', title: '固定资产', order: 80 },
  { id: 'inventory', title: '进销存', order: 90 },
  { id: 'costing', title: '成本', order: 100 },
  { id: 'analysis', title: '财务分析', order: 110 },
  { id: 'master', title: '基础档案', order: 120 },
  { id: 'system', title: '系统', order: 130 },
  { id: 'dev', title: '开发示范', order: 900 },
] as const;

export type MenuGroupId = (typeof MENU_GROUPS)[number]['id'];

export const MENU_GROUP_IDS = MENU_GROUPS.map((g) => g.id) as [MenuGroupId, ...MenuGroupId[]];
