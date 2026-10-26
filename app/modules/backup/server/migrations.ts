import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_backup',
    sql: `
CREATE TABLE backup_item (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, directory TEXT NOT NULL, kind TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', metadata TEXT,
 bytes INTEGER NOT NULL DEFAULT 0, digest TEXT, created_at TEXT NOT NULL,
 progress INTEGER NOT NULL DEFAULT 0, retention_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX backup_item_owner ON backup_item(owner_id, created_at);
CREATE TABLE backup_plan (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, user_id INTEGER NOT NULL,
 backup_id TEXT NOT NULL, digest TEXT NOT NULL, target_id TEXT NOT NULL,
 target_name TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL, fingerprint TEXT NOT NULL, protection_id TEXT,
 created_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX backup_plan_copy ON backup_plan(owner_id, digest, purpose) WHERE purpose = 'copy' AND status != 'cancelled';
`,
  },
]);
export type BackupTables = {
  backup_item: {
    id: string;
    owner_id: string;
    request_id: string;
    name: string;
    directory: string;
    kind: string;
    status: string;
    reason: string;
    metadata: string | null;
    bytes: number;
    digest: string | null;
    created_at: string;
    progress: number;
    retention_note: string;
  };
  backup_plan: {
    id: string;
    owner_id: string;
    user_id: number;
    backup_id: string;
    digest: string;
    target_id: string;
    target_name: string;
    purpose: string;
    expires_at: string;
    status: string;
    fingerprint: string;
    protection_id: string | null;
    created_at: string;
    reason: string;
  };
};
