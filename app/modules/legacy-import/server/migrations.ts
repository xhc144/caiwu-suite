import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_import_batch',
    sql: `
CREATE TABLE legacy_import_batch (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES app_user(id),
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('prepared','checked','failed','completed')),
  payload TEXT NOT NULL,
  options TEXT NOT NULL,
  issues TEXT NOT NULL,
  summary TEXT NOT NULL,
  fingerprint TEXT,
  receipt TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX legacy_import_owner ON legacy_import_batch(owner_id, created_at);
CREATE TABLE legacy_import_source (
  batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
  file_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  PRIMARY KEY(batch_id, file_index)
);
CREATE TABLE legacy_import_voucher (
  fingerprint TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES legacy_import_batch(id),
  original_key TEXT NOT NULL,
  voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL
);
`,
  },
]);

export type ImportTables = {
  legacy_import_source: {
    batch_id: string;
    file_index: number;
    name: string;
    content_base64: string;
  };
  legacy_import_voucher: {
    fingerprint: string;
    batch_id: string;
    original_key: string;
    voucher_id: number | null;
  };
  legacy_import_batch: {
    id: string;
    name: string;
    owner_id: number;
    revision: number;
    status: 'prepared' | 'checked' | 'failed' | 'completed';
    payload: string;
    options: string;
    issues: string;
    summary: string;
    fingerprint: string | null;
    receipt: string | null;
    created_at: string;
    updated_at: string;
  };
};
