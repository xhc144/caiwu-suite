import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_masterdata',
    sql: `
CREATE TABLE masterdata_money_root (
 account_id INTEGER PRIMARY KEY REFERENCES account(id),
 kind TEXT NOT NULL CHECK(kind IN ('cash','bank','other'))
);
INSERT INTO masterdata_money_root(account_id,kind)
 SELECT id,CASE WHEN is_cash=1 THEN 'cash' ELSE 'bank' END FROM account
 WHERE parent_id IS NULL AND (is_cash=1 OR is_bank=1);
CREATE TABLE masterdata_reference_extra (
 kind TEXT NOT NULL,
 ref_id INTEGER NOT NULL,
 catalog_code TEXT NOT NULL DEFAULT '',
 full_name TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT '',
 shortcut TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(kind,ref_id)
);
CREATE UNIQUE INDEX masterdata_reference_catalog_code ON masterdata_reference_extra(kind,catalog_code) WHERE catalog_code<>'';
CREATE TABLE masterdata_currency_account (
 currency_code TEXT PRIMARY KEY REFERENCES currency(code),
 account_id INTEGER REFERENCES account(id)
);
`,
  },
]);

export type MasterdataTables = {
  masterdata_money_root: { account_id: number; kind: 'cash' | 'bank' | 'other' };
  masterdata_reference_extra: {
    kind: string;
    ref_id: number;
    catalog_code: string;
    full_name: string;
    category: string;
    shortcut: string;
  };
  masterdata_currency_account: { currency_code: string; account_id: number | null };
};
