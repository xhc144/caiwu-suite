import { defineMigrations } from '@caiwu/db';
export const migrations = defineMigrations([
  {
    id: '0001_formats',
    sql: `
CREATE TABLE print_settings_format (
 code INTEGER PRIMARY KEY CHECK(code >= 0 AND code < 100),
 name TEXT NOT NULL,
 definition TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1
);
`,
  },
]);
export type PrintSettingsTables = {
  print_settings_format: { code: number; name: string; definition: string; revision: number };
};
