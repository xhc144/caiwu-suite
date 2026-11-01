import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { legacyTemplateCatalog } from '../legacy-catalog';
import { integrationModules } from './template-fixtures';
import { supplements } from '../server/supplement-catalog';
import { parseTemplate } from '@caiwu/core';

it('w_xt_kgzb_a2：原44项逐行覆盖，不因新版或地方参考映射冒充恢复', () => {
  const source = readFileSync(
    new URL('../../../../docs/original-analysis/data/tables.md', import.meta.url),
    'utf8',
  );
  const rows = [...source.matchAll(/^\| (a\d{2}\.acd) \| (\d+) \| (.+?) \|\r?$/gm)].map((m) => ({
    file: m[1],
    order: Number(m[2]),
    name: m[3],
  }));
  expect(rows).toHaveLength(44);
  expect(legacyTemplateCatalog.map(({ file, order, name }) => ({ file, order, name }))).toEqual(
    rows,
  );
  expect(new Set(legacyTemplateCatalog.map((r) => r.file)).size).toBe(44);
  const registered = new Set([
    ...integrationModules.flatMap((m) => m.templates).map((t) => parseTemplate(t).id),
    ...supplements.flatMap((s) => s.presets ?? []).map((p) => p.id),
  ]);
  for (const row of legacyTemplateCatalog) {
    expect(row.remaining).not.toBe('');
    for (const id of row.templateIds) {
      expect(registered.has(id), `${row.file}映射${id}`).toBe(true);
    }
  }
  expect(legacyTemplateCatalog.find((r) => r.file === 'a46.acd')?.coverage).toBe('reference-only');
  expect(legacyTemplateCatalog.find((r) => r.file === 'a51.acd')?.templateIds).toEqual([]);
  expect(legacyTemplateCatalog.filter((r) => r.coverage === 'current')).toHaveLength(16);
  expect(legacyTemplateCatalog.filter((r) => r.coverage === 'historical-missing')).toHaveLength(16);
});
