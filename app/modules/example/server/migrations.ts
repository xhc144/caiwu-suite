import { defineMigrations, type Generated } from '@caiwu/db';

// 模块自己的表，表名必须以模块 id 为前缀（example_）。已发布的迁移不要改，新增字段写新迁移。
export const migrations = defineMigrations([
  {
    id: '0001_memo',
    sql: /* sql */ `
CREATE TABLE example_memo (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  period INTEGER NOT NULL,
  summary TEXT NOT NULL,
  debit_account_id INTEGER NOT NULL REFERENCES account(id),
  credit_account_id INTEGER NOT NULL REFERENCES account(id),
  amount INTEGER NOT NULL,                              -- 分
  department_id INTEGER REFERENCES dimension_item(id),
  voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX example_memo_period ON example_memo(period);
`,
  },
]);

/** 本模块表的 Kysely 类型（和上面的 SQL 保持一致）。注意用 type 而不是 interface，withTables 才认。 */
export type ExampleTables = {
  example_memo: {
    id: Generated<number>;
    date: string;
    period: number;
    summary: string;
    debit_account_id: number;
    credit_account_id: number;
    amount: number;
    department_id: number | null;
    voucher_id: number | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  };
};
