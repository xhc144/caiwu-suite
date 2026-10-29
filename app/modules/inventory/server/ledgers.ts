import type { CoreServices } from '@caiwu/core/server';
import { FilterSchema, type Filter } from '../shared';
import { fail, inventoryService } from './service';

export async function inventoryLedgers(svc: CoreServices, filter: Filter, hideInactive: boolean) {
  svc.permissions.require('inventory.view');
  const f = FilterSchema.parse(filter),
    s = inventoryService(svc);
  if (!f.warehouseId) fail('FILTER', '批量台账需要选择仓库');
  const warehouse = await s.warehouse(f.warehouseId, false);
  const products = (await s.products(f.keyword)).filter(
    (p) =>
      (!f.productCode || p.code === f.productCode) &&
      (!f.productFrom || p.code >= f.productFrom) &&
      (!f.productTo || p.code <= f.productTo),
  );
  const books = [];
  for (const p of products) {
    const rows = await s.ledger({ ...f, productCode: p.code, hideZero: false });
    if (!rows.length || (hideInactive && rows.length === 1)) continue;
    books.push({
      productId: p.id,
      productCode: p.code,
      productName: p.name,
      unit: p.unit,
      warehouseName: warehouse.name,
      rows,
    });
  }
  return books;
}
