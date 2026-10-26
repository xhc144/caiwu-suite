import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_plans',
    sql: `
CREATE TABLE voucher_book_plan (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id),
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result TEXT
);
`,
  },
]);
export type VoucherBookTables = {
  voucher_book_plan: {
    token: string;
    user_id: number;
    action: string;
    payload: string;
    created_at: string;
    result: string | null;
  };
};
