import { defineMigrations } from '@caiwu/db';
export const migrations = defineMigrations([
  {
    id: '0001_user_preferences',
    sql: `
CREATE TABLE workbench_user_preference (
  user_id INTEGER PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  favorites TEXT NOT NULL DEFAULT '[]',
  guided INTEGER NOT NULL DEFAULT 0
);
`,
  },
]);
export type WorkbenchTables = {
  workbench_user_preference: { user_id: number; favorites: string; guided: number };
};
