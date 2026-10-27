import { defineMigrations, type Generated } from '@caiwu/db';

export const migrations = defineMigrations([
  {
    id: '0001_reports',
    sql: `
CREATE TABLE report_engine_template (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL
);
CREATE TABLE report_engine_snapshot (
  id INTEGER PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES report_engine_template(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  period INTEGER NOT NULL,
  include_unposted INTEGER NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX report_engine_snapshot_selection ON report_engine_snapshot(report_id, period, include_unposted, id);
`,
  },
  {
    id: '0002_statutory_profiles',
    sql: `
CREATE TABLE report_engine_statutory_profile (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  profile_json TEXT NOT NULL
);
CREATE TABLE report_engine_statutory_snapshot (
  id INTEGER PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES report_engine_statutory_profile(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  period INTEGER NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX report_engine_statutory_selection ON report_engine_statutory_snapshot(profile_id, period, id);
`,
  },
]);
export type ReportTables = {
  report_engine_statutory_profile: {
    id: Generated<number>;
    code: string;
    name: string;
    revision: number;
    profile_json: string;
  };
  report_engine_statutory_snapshot: {
    id: Generated<number>;
    profile_id: number;
    request_id: string;
    request_json: string;
    period: number;
    result_json: string;
  };
  report_engine_template: {
    id: Generated<number>;
    code: string;
    name: string;
    revision: number;
    definition_json: string;
  };
  report_engine_snapshot: {
    id: Generated<number>;
    report_id: number;
    request_id: string;
    request_json: string;
    period: number;
    include_unposted: number;
    result_json: string;
  };
};
