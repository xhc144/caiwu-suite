import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_cashier',
    sql: `
CREATE TABLE cashier_account (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 core_account_id INTEGER NOT NULL REFERENCES account(id),
 currency TEXT NOT NULL,
 disabled INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(core_account_id, currency)
);
CREATE TABLE cashier_opening (
 account_id INTEGER NOT NULL REFERENCES cashier_account(id),
 period INTEGER NOT NULL,
 balance INTEGER NOT NULL,
 PRIMARY KEY(account_id, period)
);
CREATE TABLE cashier_period (
 period INTEGER PRIMARY KEY,
 closed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE cashier_batch (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_key TEXT NOT NULL UNIQUE,
 input_json TEXT NOT NULL,
 mode TEXT NOT NULL,
 date TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE cashier_document (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_key TEXT NOT NULL UNIQUE,
 original_json TEXT NOT NULL,
 deleted INTEGER NOT NULL DEFAULT 0,
 account_id INTEGER NOT NULL REFERENCES cashier_account(id),
 date TEXT NOT NULL,
 period INTEGER NOT NULL,
 summary TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('receipt','payment')),
 amount INTEGER NOT NULL CHECK(amount > 0),
 opposite_account_id INTEGER REFERENCES account(id),
 dimensions_json TEXT NOT NULL,
 ref_no TEXT NOT NULL,
 note TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX cashier_document_account_date ON cashier_document(account_id,date);
CREATE TABLE cashier_batch_document (
 batch_id INTEGER NOT NULL REFERENCES cashier_batch(id),
 document_id INTEGER NOT NULL REFERENCES cashier_document(id),
 voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL,
 PRIMARY KEY(batch_id, document_id)
);
CREATE UNIQUE INDEX cashier_active_document ON cashier_batch_document(document_id) WHERE voucher_id IS NOT NULL;
CREATE TABLE cashier_match (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id INTEGER NOT NULL REFERENCES cashier_account(id),
 amount INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE cashier_match_document (
 document_id INTEGER PRIMARY KEY REFERENCES cashier_document(id),
 match_id INTEGER NOT NULL REFERENCES cashier_match(id)
);
CREATE TABLE cashier_match_line (
 line_id INTEGER PRIMARY KEY REFERENCES voucher_line(id),
 match_id INTEGER NOT NULL REFERENCES cashier_match(id),
 voucher_revision INTEGER NOT NULL
);
`,
  },
]);

export type CashierTables = {
  cashier_account: {
    id: Generated<number>;
    name: string;
    core_account_id: number;
    currency: string;
    disabled: Generated<number>;
    used: Generated<number>;
    revision: Generated<number>;
  };
  cashier_opening: { account_id: number; period: number; balance: number };
  cashier_period: { period: number; closed: Generated<number> };
  cashier_batch: {
    id: Generated<number>;
    request_key: string;
    input_json: string;
    mode: string;
    date: string;
    active: Generated<number>;
  };
  cashier_document: {
    id: Generated<number>;
    request_key: string;
    original_json: string;
    deleted: Generated<number>;
    account_id: number;
    date: string;
    period: number;
    summary: string;
    direction: 'receipt' | 'payment';
    amount: number;
    opposite_account_id: number | null;
    dimensions_json: string;
    ref_no: string;
    note: string;
    revision: Generated<number>;
  };
  cashier_batch_document: { batch_id: number; document_id: number; voucher_id: number | null };
  cashier_match: { id: Generated<number>; account_id: number; amount: number; created_at: string };
  cashier_match_document: { document_id: number; match_id: number };
  cashier_match_line: { line_id: number; match_id: number; voucher_revision: number };
};
