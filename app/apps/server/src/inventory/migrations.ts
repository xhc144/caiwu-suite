import { migrations as inventoryMigrations } from '../../../../modules/inventory/server/migrations';
export type { InventoryTables } from '../../../../modules/inventory/server/migrations';

// 保留旧宿主接线的迁移入口；SQL 和编号只由库存模块维护。
export const migrations = inventoryMigrations.filter((migration) =>
  ['0002_count_amount_snapshot', '0003_costing_contract'].includes(migration.id),
);
