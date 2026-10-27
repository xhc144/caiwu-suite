import { defineMigrations, type Generated } from '@caiwu/db';
export const migrations = defineMigrations([
  {
    id: '0001_inventory',
    sql: `
CREATE TABLE inventory_product (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, specification TEXT NOT NULL,
 unit TEXT NOT NULL, receipt_price TEXT NOT NULL, issue_price TEXT NOT NULL, plan_price TEXT NOT NULL,
 inventory_account_id INTEGER REFERENCES account(id), sales_account_id INTEGER REFERENCES account(id),
 allocation_factor TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE inventory_warehouse (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('warehouse','workshop')), disabled INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE inventory_control (
 id INTEGER PRIMARY KEY CHECK(id=1), stock_revision INTEGER NOT NULL DEFAULT 0, opening_revision INTEGER NOT NULL DEFAULT 0,
 cost_cutoff_date TEXT, cost_period INTEGER, cost_batch TEXT, opening_locked INTEGER NOT NULL DEFAULT 0
);
INSERT INTO inventory_control(id) VALUES(1);
CREATE TABLE inventory_opening (
 id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id),
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), quantity_e6 INTEGER NOT NULL, unit_price TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, calculation_status TEXT NOT NULL DEFAULT 'uncalculated', calculation_batch TEXT, calculation_period INTEGER,
 UNIQUE(warehouse_id, product_id)
);
CREATE TABLE inventory_document (
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('receipt','issue')), warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id),
 number TEXT NOT NULL, date TEXT NOT NULL, period INTEGER NOT NULL, category TEXT NOT NULL, operator TEXT NOT NULL, summary TEXT NOT NULL,
 account_id INTEGER REFERENCES account(id), cost_account_id INTEGER REFERENCES account(id), tax_rate TEXT NOT NULL,
 audited_by INTEGER REFERENCES app_user(id), audited_at TEXT, voucher_id INTEGER REFERENCES voucher(id),
 calculation_status TEXT NOT NULL DEFAULT 'uncalculated', calculation_batch TEXT, calculation_period INTEGER, calculation_cutoff_date TEXT,
 source_type TEXT, source_id INTEGER, revision INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES app_user(id),
 UNIQUE(kind, warehouse_id, number)
);
CREATE INDEX inventory_document_date ON inventory_document(warehouse_id,date);
CREATE TABLE inventory_line (
 id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES inventory_document(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), position INTEGER NOT NULL, quantity_e6 INTEGER NOT NULL,
 unit_price TEXT NOT NULL, tax_unit_price TEXT NOT NULL, price_includes_tax INTEGER NOT NULL,
 net_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL, note TEXT NOT NULL,
 outbound_cost_cents INTEGER, unit_cost TEXT, calculation_status TEXT NOT NULL DEFAULT 'uncalculated', calculation_batch TEXT, calculation_period INTEGER,
 UNIQUE(document_id,position)
);
CREATE INDEX inventory_line_product ON inventory_line(product_id);
CREATE TABLE inventory_request (
 request_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, document_id INTEGER NOT NULL REFERENCES inventory_document(id) ON DELETE CASCADE
);
CREATE TABLE inventory_count (
 id INTEGER PRIMARY KEY AUTOINCREMENT, warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id), period INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, calculation_status TEXT NOT NULL DEFAULT 'uncalculated', calculation_batch TEXT,
 UNIQUE(warehouse_id,period)
);
CREATE TABLE inventory_count_line (
 id INTEGER PRIMARY KEY AUTOINCREMENT, count_id INTEGER NOT NULL REFERENCES inventory_count(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), book_e6 INTEGER NOT NULL, actual_e6 INTEGER NOT NULL, note TEXT NOT NULL,
 UNIQUE(count_id,product_id)
);
CREATE TABLE inventory_contract (
 id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, warehouse_id INTEGER NOT NULL REFERENCES inventory_warehouse(id),
 supplier_id INTEGER NOT NULL REFERENCES dimension_item(id), date TEXT NOT NULL, agent TEXT NOT NULL, due_date TEXT, note TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','completed','cancelled')), revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE inventory_contract_line (
 id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id INTEGER NOT NULL REFERENCES inventory_contract(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL REFERENCES inventory_product(id), quantity_e6 INTEGER NOT NULL, unit_price TEXT NOT NULL, amount_cents INTEGER NOT NULL, note TEXT NOT NULL
);
`,
  },
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
  {
    id: '0004_opening_value_basis',
    sql: `ALTER TABLE inventory_opening ADD COLUMN value_basis TEXT NOT NULL DEFAULT 'unitPrice' CHECK(value_basis IN ('unitPrice','amount'));`,
  },
]);
type Id = { id: Generated<number> };
export type InventoryTables = {
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
  inventory_product: Id & {
    code: string;
    name: string;
    specification: string;
    unit: string;
    receipt_price: string;
    issue_price: string;
    plan_price: string;
    inventory_account_id: number | null;
    sales_account_id: number | null;
    allocation_factor: string;
    disabled: number;
    revision: number;
  };
  inventory_warehouse: Id & {
    code: string;
    name: string;
    kind: 'warehouse' | 'workshop';
    disabled: number;
    revision: number;
  };
  inventory_control: {
    id: number;
    stock_revision: number;
    opening_revision: number;
    cost_cutoff_date: string | null;
    cost_period: number | null;
    cost_batch: string | null;
    opening_locked: number;
  };
  inventory_opening: Id & {
    warehouse_id: number;
    product_id: number;
    quantity_e6: number;
    unit_price: string;
    amount_cents: number;
    value_basis: 'unitPrice' | 'amount';
    calculation_status: string;
    calculation_batch: string | null;
    calculation_period: number | null;
  };
  inventory_document: Id & {
    kind: 'receipt' | 'issue';
    warehouse_id: number;
    number: string;
    date: string;
    period: number;
    category: string;
    operator: string;
    summary: string;
    account_id: number | null;
    cost_account_id: number | null;
    tax_rate: string;
    audited_by: number | null;
    audited_at: string | null;
    voucher_id: number | null;
    calculation_status: string;
    calculation_batch: string | null;
    calculation_period: number | null;
    calculation_cutoff_date: string | null;
    source_type: string | null;
    source_id: number | null;
    revision: number;
    created_by: number;
  };
  inventory_line: Id & {
    document_id: number;
    product_id: number;
    position: number;
    quantity_e6: number;
    unit_price: string;
    tax_unit_price: string;
    price_includes_tax: number;
    net_cents: number;
    tax_cents: number;
    gross_cents: number;
    note: string;
    outbound_cost_cents: number | null;
    unit_cost: string | null;
    calculation_status: string;
    calculation_batch: string | null;
    calculation_period: number | null;
  };
  inventory_request: { request_key: string; payload_hash: string; document_id: number };
  inventory_count: Id & {
    warehouse_id: number;
    period: number;
    revision: number;
    calculation_status: string;
    calculation_batch: string | null;
  };
  inventory_count_line: Id & {
    count_id: number;
    product_id: number;
    book_e6: number;
    book_cents: number | null;
    actual_e6: number;
    note: string;
  };
  inventory_contract: Id & {
    number: string;
    warehouse_id: number;
    supplier_id: number;
    date: string;
    agent: string;
    due_date: string | null;
    note: string;
    status: 'open' | 'completed' | 'cancelled';
    revision: number;
  };
  inventory_contract_line: Id & {
    contract_id: number;
    product_id: number;
    quantity_e6: number;
    unit_price: string;
    amount_cents: number;
    note: string;
  };
};
