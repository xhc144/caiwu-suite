import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_fixed_assets',
    sql: `
CREATE TABLE fixed_assets_master (
 id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
 account_id INTEGER REFERENCES account(id), rate TEXT NOT NULL, depreciates INTEGER NOT NULL,
 disabled INTEGER NOT NULL, UNIQUE(kind,code)
);
CREATE TABLE fixed_assets_card (
 id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, reference TEXT NOT NULL,
 category_id INTEGER NOT NULL REFERENCES fixed_assets_master(id), status_id INTEGER NOT NULL REFERENCES fixed_assets_master(id),
 purpose_id INTEGER NOT NULL REFERENCES fixed_assets_master(id), department_id INTEGER NOT NULL REFERENCES dimension_item(id),
 acquired TEXT NOT NULL, use_date TEXT NOT NULL, original INTEGER NOT NULL, base_original INTEGER NOT NULL,
 residual INTEGER NOT NULL, rate TEXT NOT NULL, method TEXT NOT NULL, life_months INTEGER NOT NULL, model TEXT NOT NULL,
 is_opening INTEGER NOT NULL DEFAULT 0, unit TEXT NOT NULL, quantity_e6 INTEGER NOT NULL, total_work_e6 INTEGER NOT NULL, work_e6 INTEGER NOT NULL,
 depreciation INTEGER NOT NULL, months INTEGER NOT NULL, opening_depreciation INTEGER NOT NULL, opening_months INTEGER NOT NULL, opening_work_e6 INTEGER NOT NULL,
 disposal_date TEXT, reason_id INTEGER REFERENCES fixed_assets_master(id), voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL, revision INTEGER NOT NULL DEFAULT 1,
 CHECK(original>0), CHECK(residual>=0), CHECK(depreciation>=0), CHECK(depreciation<=original-residual)
);
CREATE TABLE fixed_assets_accessory (
 id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL REFERENCES fixed_assets_card(id) ON DELETE CASCADE,
 code TEXT NOT NULL, name TEXT NOT NULL, quantity_e6 INTEGER NOT NULL, unit_price TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT NOT NULL,
 UNIQUE(asset_id,code)
);
CREATE TABLE fixed_assets_adjustment (
 id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER NOT NULL REFERENCES fixed_assets_card(id), date TEXT NOT NULL,
 before_value INTEGER NOT NULL, after_value INTEGER NOT NULL, note TEXT NOT NULL
);
CREATE TABLE fixed_assets_work (
 asset_id INTEGER NOT NULL REFERENCES fixed_assets_card(id) ON DELETE CASCADE, period INTEGER NOT NULL, quantity_e6 INTEGER NOT NULL,
 PRIMARY KEY(asset_id,period)
);
CREATE TABLE fixed_assets_batch (
 id INTEGER PRIMARY KEY AUTOINCREMENT, period INTEGER NOT NULL UNIQUE, voucher_id INTEGER REFERENCES voucher(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE TABLE fixed_assets_line (
 id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL REFERENCES fixed_assets_batch(id) ON DELETE CASCADE,
 asset_id INTEGER NOT NULL REFERENCES fixed_assets_card(id), amount INTEGER NOT NULL, work_e6 INTEGER NOT NULL, month_count INTEGER NOT NULL,
 issue TEXT NOT NULL, before_depreciation INTEGER NOT NULL, before_months INTEGER NOT NULL, before_work_e6 INTEGER NOT NULL,
 original INTEGER NOT NULL, residual INTEGER NOT NULL, category_id INTEGER NOT NULL, purpose_id INTEGER NOT NULL, department_id INTEGER NOT NULL,
 UNIQUE(batch_id,asset_id)
);
CREATE INDEX fixed_assets_line_asset ON fixed_assets_line(asset_id);
`,
  },
]);
export type CardRow = {
  id: Generated<number>;
  code: string;
  name: string;
  reference: string;
  category_id: number;
  status_id: number;
  purpose_id: number;
  department_id: number;
  acquired: string;
  use_date: string;
  original: number;
  base_original: number;
  residual: number;
  rate: string;
  method: string;
  life_months: number;
  model: string;
  unit: string;
  is_opening: number;
  quantity_e6: number;
  total_work_e6: number;
  work_e6: number;
  depreciation: number;
  months: number;
  opening_depreciation: number;
  opening_months: number;
  opening_work_e6: number;
  disposal_date: string | null;
  reason_id: number | null;
  voucher_id: number | null;
  revision: number;
};
export type FixedAssetsTables = {
  fixed_assets_master: {
    id: Generated<number>;
    kind: string;
    code: string;
    name: string;
    account_id: number | null;
    rate: string;
    depreciates: number;
    disabled: number;
  };
  fixed_assets_card: CardRow;
  fixed_assets_accessory: {
    id: Generated<number>;
    asset_id: number;
    code: string;
    name: string;
    quantity_e6: number;
    unit_price: string;
    amount: number;
    note: string;
  };
  fixed_assets_adjustment: {
    id: Generated<number>;
    asset_id: number;
    date: string;
    before_value: number;
    after_value: number;
    note: string;
  };
  fixed_assets_work: { asset_id: number; period: number; quantity_e6: number };
  fixed_assets_batch: {
    id: Generated<number>;
    period: number;
    voucher_id: number | null;
    created_at: string;
  };
  fixed_assets_line: {
    id: Generated<number>;
    batch_id: number;
    asset_id: number;
    amount: number;
    work_e6: number;
    month_count: number;
    issue: string;
    before_depreciation: number;
    before_months: number;
    before_work_e6: number;
    original: number;
    residual: number;
    category_id: number;
    purpose_id: number;
    department_id: number;
  };
};
