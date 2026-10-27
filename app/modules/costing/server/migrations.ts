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
]);

export type CostingTables = {
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
