import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_worksheet',
    sql: `
CREATE TABLE costing_worksheet (
  id INTEGER PRIMARY KEY,
  period INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  adjust_zero_quantity INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('preview','cancelled')),
  result_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE UNIQUE INDEX costing_active_worksheet ON costing_worksheet(period) WHERE status='preview';
`,
  },
  {
    id: '0002_formal_calculation',
    sql: `
CREATE TABLE costing_calculation (
  batch_id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  period INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);
CREATE TABLE costing_count_voucher (
  count_id INTEGER PRIMARY KEY,
  batch_id TEXT NOT NULL,
  voucher_id INTEGER NOT NULL UNIQUE REFERENCES voucher(id),
  revision INTEGER NOT NULL DEFAULT 1
);
`,
  },
  {
    id: '0003_production_profit_currency',
    sql: `
CREATE TABLE costing_production (
  id INTEGER PRIMARY KEY,
  period INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  document_id INTEGER UNIQUE,
  voucher_id INTEGER UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('saved','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);
CREATE TABLE costing_profit_config (
  period INTEGER PRIMARY KEY,
  expense_account_id INTEGER NOT NULL REFERENCES account(id),
  surcharge_account_id INTEGER NOT NULL REFERENCES account(id),
  profit_account_id INTEGER NOT NULL REFERENCES account(id),
  revision INTEGER NOT NULL,
  voucher_id INTEGER UNIQUE REFERENCES voucher(id)
);
CREATE TABLE costing_source_currency (
  document_id INTEGER PRIMARY KEY REFERENCES inventory_document(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  exchange_rate TEXT NOT NULL,
  net_fc_cents INTEGER NOT NULL,
  tax_fc_cents INTEGER NOT NULL,
  gross_fc_cents INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  source_revision INTEGER NOT NULL
);
`,
  },
]);

export type CostingTables = {
  costing_production: {
    id: Generated<number>;
    period: number;
    warehouse_id: number;
    date: string;
    request_key: string;
    request_hash: string;
    fingerprint: string;
    result_json: string;
    document_id: number | null;
    voucher_id: number | null;
    status: 'saved' | 'cancelled';
    revision: number;
    created_by: number;
    created_at: string;
  };
  costing_profit_config: {
    period: number;
    expense_account_id: number;
    surcharge_account_id: number;
    profit_account_id: number;
    revision: number;
    voucher_id: number | null;
  };
  costing_source_currency: {
    document_id: number;
    currency: string;
    exchange_rate: string;
    net_fc_cents: number;
    tax_fc_cents: number;
    gross_fc_cents: number;
    revision: number;
    source_revision: number;
  };
  costing_calculation: {
    batch_id: string;
    request_key: string;
    request_hash: string;
    period: number;
    result_json: string;
    created_by: number;
    created_at: string;
  };
  costing_count_voucher: {
    count_id: number;
    batch_id: string;
    voucher_id: number;
    revision: number;
  };
  costing_worksheet: {
    id: Generated<number>;
    period: number;
    fingerprint: string;
    adjust_zero_quantity: number;
    status: 'preview' | 'cancelled';
    result_json: string;
    revision: number;
    created_by: number;
    created_at: string;
    cancelled_at: string | null;
  };
};
