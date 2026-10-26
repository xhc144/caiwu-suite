import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_entry',
    sql: `
CREATE TABLE voucher_entry_template (
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 voucher_type_id INTEGER NOT NULL REFERENCES voucher_type(id), revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE voucher_entry_template_line (
 template_id INTEGER NOT NULL REFERENCES voucher_entry_template(id) ON DELETE CASCADE,
 line_no INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(template_id, line_no)
);
CREATE TABLE voucher_entry_buffer (
 user_id INTEGER NOT NULL REFERENCES app_user(id), client_key TEXT NOT NULL,
 voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL, voucher_revision INTEGER,
 payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id, client_key)
);
`,
  },
]);
export type EntryTables = {
  voucher_entry_template: {
    id: Generated<number>;
    code: string;
    name: string;
    voucher_type_id: number;
    revision: number;
  };
  voucher_entry_template_line: { template_id: number; line_no: number; payload: string };
  voucher_entry_buffer: {
    user_id: number;
    client_key: string;
    voucher_id: number | null;
    voucher_revision: number | null;
    payload: string;
    revision: number;
    updated_at: string;
  };
};
