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
]);

export type CostingTables = {
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
