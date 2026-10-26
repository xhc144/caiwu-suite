import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_period_close',
    sql: `
CREATE TABLE period_close_rule (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE period_close_run (
  period INTEGER NOT NULL REFERENCES period(period),
  rule_id INTEGER NOT NULL REFERENCES period_close_rule(id),
  voucher_id INTEGER NOT NULL UNIQUE REFERENCES voucher(id),
  basis TEXT NOT NULL,
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (period, rule_id)
);
CREATE TABLE period_close_year (
  source_year INTEGER PRIMARY KEY REFERENCES fiscal_year(year),
  target_year INTEGER NOT NULL UNIQUE REFERENCES fiscal_year(year),
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
]);
export type PeriodCloseTables = {
  period_close_rule: { id: Generated<number>; code: string; definition: string; revision: number };
  period_close_run: {
    period: number;
    rule_id: number;
    voucher_id: number;
    basis: string;
    definition: string;
    created_at: string;
  };
  period_close_year: {
    source_year: number;
    target_year: number;
    snapshot: string;
    created_at: string;
  };
};
