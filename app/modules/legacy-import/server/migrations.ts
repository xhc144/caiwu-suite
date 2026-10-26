import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_import',
    sql: `
CREATE TABLE legacy_import_batch (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL CHECK(status IN ('prepared', 'completed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  files_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  reconciliation_json TEXT
);
CREATE UNIQUE INDEX legacy_import_completed_hash ON legacy_import_batch(content_hash)
WHERE status = 'completed';
`,
  },
]);

export type ImportTables = {
  legacy_import_batch: {
    id: string;
    owner_id: number;
    status: 'prepared' | 'completed';
    created_at: string;
    expires_at: string;
    files_json: string;
    content_hash: string;
    plan_json: string;
    target_hash: string;
    reconciliation_json: string | null;
  };
};
