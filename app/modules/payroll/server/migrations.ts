import { defineMigrations, type Generated } from '@caiwu/db';
export const migrations = defineMigrations([
  {
    id: '0001_payroll',
    sql: `
CREATE TABLE payroll_category(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE payroll_employee(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, data TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES dimension_item(id));
CREATE TABLE payroll_batch(id INTEGER PRIMARY KEY, period INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES payroll_category(id), revision INTEGER NOT NULL, category_json TEXT NOT NULL, calculated INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, UNIQUE(period,category_id));
CREATE TABLE payroll_row(batch_id INTEGER NOT NULL REFERENCES payroll_batch(id), employee_id INTEGER NOT NULL REFERENCES payroll_employee(id), input_json TEXT NOT NULL, snapshot_json TEXT, PRIMARY KEY(batch_id,employee_id));
CREATE INDEX payroll_history ON payroll_row(employee_id,batch_id);
CREATE TABLE payroll_voucher(batch_id INTEGER NOT NULL REFERENCES payroll_batch(id), kind TEXT NOT NULL, voucher_id INTEGER NOT NULL REFERENCES voucher(id), PRIMARY KEY(batch_id,kind));
`,
  },
  {
    id: '0002_payroll_period',
    sql: `CREATE TABLE payroll_period(period INTEGER NOT NULL, category_id INTEGER NOT NULL REFERENCES payroll_category(id), batch_id INTEGER NOT NULL UNIQUE REFERENCES payroll_batch(id), closed INTEGER NOT NULL, next_batch_id INTEGER REFERENCES payroll_batch(id), PRIMARY KEY(period,category_id));`,
  },
  {
    id: '0003_previous_calculation',
    sql: `ALTER TABLE payroll_batch ADD COLUMN previous_json TEXT NOT NULL DEFAULT '[]';`,
  },
  {
    id: '0004_quantity',
    sql: `CREATE TABLE payroll_quantity(batch_id INTEGER NOT NULL, employee_id INTEGER NOT NULL, field_key TEXT NOT NULL, quantity_e6 INTEGER NOT NULL, PRIMARY KEY(batch_id,employee_id,field_key), FOREIGN KEY(batch_id,employee_id) REFERENCES payroll_row(batch_id,employee_id) ON DELETE CASCADE);`,
  },
  {
    id: '0005_hr_profiles',
    sql: `CREATE TABLE payroll_hr_profile(employee_id INTEGER PRIMARY KEY REFERENCES payroll_employee(id), employment_json TEXT NOT NULL, values_json TEXT NOT NULL);`,
  },
  {
    id: '0006_history',
    sql: `CREATE TABLE payroll_correction(id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES payroll_batch(id), reason TEXT NOT NULL, created_at TEXT NOT NULL, user_id INTEGER NOT NULL, user_name TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL); CREATE INDEX payroll_correction_batch ON payroll_correction(batch_id,id);`,
  },
  {
    id: '0007_transfer',
    sql: `CREATE TABLE payroll_transfer_backup(id INTEGER PRIMARY KEY,created_at TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,reason TEXT NOT NULL); CREATE TABLE payroll_transfer_origin(batch_id INTEGER PRIMARY KEY REFERENCES payroll_batch(id),source_book_id TEXT NOT NULL,source_book_name TEXT NOT NULL,source_batch_id INTEGER NOT NULL,imported_at TEXT NOT NULL,data TEXT NOT NULL);`,
  },
]);
export type PayrollTables = {
  payroll_correction: {
    id: Generated<number>;
    batch_id: number;
    reason: string;
    created_at: string;
    user_id: number;
    user_name: string;
    before_json: string;
    after_json: string;
  };
  payroll_quantity: {
    batch_id: number;
    employee_id: number;
    field_key: string;
    quantity_e6: number;
  };
  payroll_period: {
    period: number;
    category_id: number;
    batch_id: number;
    closed: number;
    next_batch_id: number | null;
  };
  payroll_category: { id: Generated<number>; name: string; revision: number; data: string };
  payroll_employee: {
    id: Generated<number>;
    code: string;
    revision: number;
    data: string;
    department_id: number;
  };
  payroll_batch: {
    id: Generated<number>;
    period: number;
    category_id: number;
    revision: number;
    category_json: string;
    previous_json: Generated<string>;
    calculated: number;
    closed: number;
  };
  payroll_row: {
    batch_id: number;
    employee_id: number;
    input_json: string;
    snapshot_json: string | null;
  };
  payroll_voucher: { batch_id: number; kind: string; voucher_id: number };
};
