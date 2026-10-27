import { defineMigrations } from '@caiwu/db';
import type { InventoryTables as BaseTables } from '../../../../modules/inventory/server/migrations';
export const migrations = defineMigrations([
  {
    id: '0002_count_amount_snapshot',
    sql: `ALTER TABLE inventory_count_line ADD COLUMN book_cents INTEGER;`,
  },
  {
    id: '0003_costing_contract',
    sql: `
CREATE TABLE inventory_costing_batch (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
 period INTEGER NOT NULL, previous_batch_id TEXT REFERENCES inventory_costing_batch(id),
 status TEXT NOT NULL CHECK(status IN ('calculated','cancelled')), revision INTEGER NOT NULL DEFAULT 1,
 fingerprint TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES app_user(id), module_id TEXT NOT NULL,
 before_json TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_at TEXT
);
CREATE UNIQUE INDEX inventory_costing_active_period ON inventory_costing_batch(period) WHERE status='calculated';
CREATE TABLE inventory_costing_balance (
 batch_id TEXT NOT NULL REFERENCES inventory_costing_batch(id), warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id),
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), quantity_e6 INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
 PRIMARY KEY(batch_id,warehouse_id,product_id)
);
CREATE TABLE inventory_costing_adjustment (
 batch_id TEXT NOT NULL REFERENCES inventory_costing_batch(id), warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id),
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), count_id INTEGER REFERENCES inventory_count(id),
 quantity_e6 INTEGER NOT NULL, amount_cents INTEGER NOT NULL, zero_cents INTEGER NOT NULL,
 PRIMARY KEY(batch_id,warehouse_id,product_id)
);
CREATE TABLE inventory_costing_month_lock (
 period INTEGER PRIMARY KEY, batch_id TEXT NOT NULL UNIQUE REFERENCES inventory_costing_batch(id)
);
CREATE TABLE inventory_voucher_source (
 document_id INTEGER NOT NULL REFERENCES inventory_document(id), purpose TEXT NOT NULL CHECK(purpose IN ('receipt','revenue','cost')),
 voucher_id INTEGER NOT NULL UNIQUE REFERENCES voucher(id), owner_module TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES app_user(id),
 PRIMARY KEY(document_id,purpose)
);
`,
  },
]);
export type InventoryTables = Omit<BaseTables, 'inventory_count_line'> & {
  inventory_count_line: BaseTables['inventory_count_line'] & { book_cents: number | null };
  inventory_costing_batch: {
    id: string;
    request_key: string;
    payload_hash: string;
    period: number;
    previous_batch_id: string | null;
    status: 'calculated' | 'cancelled';
    revision: number;
    fingerprint: string;
    actor_id: number;
    module_id: string;
    before_json: string;
    created_at: string;
    cancelled_at: string | null;
  };
  inventory_costing_balance: {
    batch_id: string;
    warehouse_id: number;
    product_id: number;
    quantity_e6: number;
    amount_cents: number;
  };
  inventory_costing_adjustment: {
    batch_id: string;
    warehouse_id: number;
    product_id: number;
    count_id: number | null;
    quantity_e6: number;
    amount_cents: number;
    zero_cents: number;
  };
  inventory_costing_month_lock: { period: number; batch_id: string };
  inventory_voucher_source: {
    document_id: number;
    purpose: 'receipt' | 'revenue' | 'cost';
    voucher_id: number;
    owner_module: string;
    actor_id: number;
  };
};
