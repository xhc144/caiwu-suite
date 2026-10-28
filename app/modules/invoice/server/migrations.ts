import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_invoice',
    sql: `
CREATE TABLE invoice_batch (
  id INTEGER PRIMARY KEY, file_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE invoice_run (
  id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE invoice_group (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES invoice_run(id),
  voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL, data TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE invoice_document (
  id INTEGER PRIMARY KEY, direction TEXT NOT NULL, seller_tax_id TEXT NOT NULL,
  code TEXT NOT NULL, number TEXT NOT NULL, date TEXT NOT NULL, confirm_date TEXT,
  period INTEGER NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1, batch_id INTEGER REFERENCES invoice_batch(id),
  group_id INTEGER REFERENCES invoice_group(id), created_at TEXT NOT NULL,
  UNIQUE(direction, seller_tax_id, code, number)
);
CREATE INDEX invoice_document_period ON invoice_document(period);
CREATE TABLE invoice_line (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES invoice_document(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL, quantity_e6 INTEGER, data TEXT NOT NULL,
  UNIQUE(document_id,line_no)
);
CREATE TABLE invoice_mapping (
  direction TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE invoice_period (
  period INTEGER PRIMARY KEY, closed INTEGER NOT NULL, revision INTEGER NOT NULL
);
`,
  },
  {
    id: '0002_invoice_issue',
    sql: `
CREATE TABLE invoice_issue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoice_document(id),
  inventory_document_id INTEGER NOT NULL,
  inventory_revision INTEGER NOT NULL,
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  input TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE invoice_issue_request (
  request_key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  issue_id INTEGER NOT NULL REFERENCES invoice_issue(id),
  result TEXT NOT NULL
);
`,
  },
]);
export type InvoiceTables = {
  invoice_issue: {
    id: Generated<number>;
    invoice_id: number;
    inventory_document_id: number;
    inventory_revision: number;
    number: string;
    date: string;
    revision: Generated<number>;
    input: string;
    created_at: string;
  };
  invoice_issue_request: {
    request_key: string;
    payload_hash: string;
    issue_id: number;
    result: string;
  };
  invoice_batch: { id: Generated<number>; file_name: string; created_at: string };
  invoice_run: {
    id: Generated<number>;
    request_id: string;
    payload_hash: string;
    created_at: string;
  };
  invoice_group: {
    id: Generated<number>;
    run_id: number;
    voucher_id: number | null;
    data: string;
    revoked: number;
  };
  invoice_document: {
    id: Generated<number>;
    direction: string;
    seller_tax_id: string;
    code: string;
    number: string;
    date: string;
    confirm_date: string | null;
    period: number;
    data: string;
    state: string;
    revision: number;
    batch_id: number | null;
    group_id: number | null;
    created_at: string;
  };
  invoice_line: {
    id: Generated<number>;
    document_id: number;
    line_no: number;
    quantity_e6: number | null;
    data: string;
  };
  invoice_mapping: { direction: string; revision: number; data: string };
  invoice_period: { period: number; closed: number; revision: number };
};
