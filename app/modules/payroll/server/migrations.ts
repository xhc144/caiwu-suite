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
]);
export type PayrollTables = {
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
