import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { runMigrations } from '@caiwu/db';
import { migrations } from '../server/migrations';

it('w_cb_qc：新增口径迁移不重算或重写已有数量、单价、金额及核算状态，旧行默认为单价口径', () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(
      'CREATE TABLE account(id INTEGER PRIMARY KEY); CREATE TABLE app_user(id INTEGER PRIMARY KEY); CREATE TABLE dimension_item(id INTEGER PRIMARY KEY); CREATE TABLE voucher(id INTEGER PRIMARY KEY);',
    );
    raw.pragma('foreign_keys=ON');
    runMigrations(raw, [{ scope: 'inventory', migrations: migrations.slice(0, 3) }]);
    raw.exec(`INSERT INTO inventory_warehouse(code,name,kind) VALUES('01','旧合成仓','warehouse');
      INSERT INTO inventory_product(code,name,specification,unit,receipt_price,issue_price,plan_price,allocation_factor) VALUES('P1','旧合成产品','','件','0','0','0','1');
      INSERT INTO inventory_opening(warehouse_id,product_id,quantity_e6,unit_price,amount_cents,calculation_status,calculation_batch,calculation_period) VALUES(1,1,3000000,'0.333333',100,'calculated','history',202601);`);
    const old = raw.prepare('SELECT * FROM inventory_opening').get();
    expect(runMigrations(raw, [{ scope: 'inventory', migrations }]).applied).toEqual([
      { scope: 'inventory', id: '0004_opening_value_basis' },
    ]);
    const current = raw.prepare('SELECT * FROM inventory_opening').get() as Record<string, unknown>;
    const { value_basis, ...other } = current;
    expect(value_basis).toBe('unitPrice');
    expect(other).toEqual(old);
    expect(runMigrations(raw, [{ scope: 'inventory', migrations }]).applied).toEqual([]);
  } finally {
    raw.close();
  }
});
