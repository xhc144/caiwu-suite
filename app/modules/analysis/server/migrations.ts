import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_analysis_config',
    sql: `
CREATE TABLE analysis_aging_config (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(id),
  bounds_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0)
);
CREATE TABLE analysis_shortcut (
  kind TEXT PRIMARY KEY,
  account_code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0)
);
`,
  },
  {
    id: '0002_analysis_contracts',
    sql: `
CREATE TABLE analysis_contract (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  partner_id INTEGER NOT NULL REFERENCES dimension_item(id),
  account_id INTEGER NOT NULL REFERENCES account(id),
  signed_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('receipt', 'payment')),
  amount INTEGER NOT NULL CHECK(amount >= 0 AND amount <= 9007199254740991),
  opening INTEGER NOT NULL CHECK(opening >= 0 AND opening <= 9007199254740991),
  description TEXT NOT NULL,
  remark TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  reviewed_by INTEGER REFERENCES app_user(id),
  revision INTEGER NOT NULL CHECK(revision > 0)
);
CREATE TABLE analysis_contract_line (
  line_id INTEGER PRIMARY KEY REFERENCES voucher_line(id) ON DELETE RESTRICT,
  contract_id INTEGER NOT NULL REFERENCES analysis_contract(id) ON DELETE RESTRICT,
  linked_by INTEGER NOT NULL REFERENCES app_user(id),
  linked_at TEXT NOT NULL
);
CREATE INDEX analysis_contract_line_contract ON analysis_contract_line(contract_id);
`,
  },
]);
export type AnalysisTables = {
  analysis_aging_config: { user_id: number; bounds_json: string; revision: number };
  analysis_shortcut: { kind: string; account_code: string; revision: number };
  analysis_contract: {
    id: Generated<number>;
    code: string;
    name: string;
    partner_id: number;
    account_id: number;
    signed_date: string;
    kind: 'receipt' | 'payment';
    amount: number;
    opening: number;
    description: string;
    remark: string;
    created_by: number;
    reviewed_by: number | null;
    revision: number;
  };
  analysis_contract_line: {
    line_id: number;
    contract_id: number;
    linked_by: number;
    linked_at: string;
  };
};
