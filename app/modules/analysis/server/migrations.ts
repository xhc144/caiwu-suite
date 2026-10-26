import { defineMigrations } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_analysis_config',
    sql: `
CREATE TABLE analysis_aging_config (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(id),
  bounds_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0)
);
CREATE TABLE analysis_shortcut (
  kind TEXT PRIMARY KEY,
  account_code TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0)
);
`,
  },
]);
export type AnalysisTables = {
  analysis_aging_config: { user_id: number; bounds_json: string; revision: number };
  analysis_shortcut: { kind: string; account_code: string; revision: number };
};
