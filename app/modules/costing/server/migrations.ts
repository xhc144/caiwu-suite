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
    id: '0002_formal_batch',
    sql: `
CREATE TABLE costing_batch (
  id INTEGER PRIMARY KEY,
  period INTEGER NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  inventory_batch_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('calculated','cancelled')),
  revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  adjust_zero_quantity INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  commit_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  module_id TEXT NOT NULL CHECK(module_id='costing'),
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE UNIQUE INDEX costing_active_batch ON costing_batch(period) WHERE status='calculated';
`,
  },
]);

export type CostingTables = {
  costing_batch: {
    id: Generated<number>;
    period: number;
    request_key: string;
    request_hash: string;
    inventory_batch_id: string;
    status: 'calculated' | 'cancelled';
    revision: number;
    fingerprint: string;
    adjust_zero_quantity: number;
    snapshot_json: string;
    commit_json: string;
    result_json: string;
    created_by: number;
    module_id: string;
    created_at: string;
    cancelled_at: string | null;
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
