import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { DEFAULT_COLUMNS, parseLedgerUrl, QuerySchema } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());

describe('账册无发生科目选择', () => {
  it('w_print_2_zw/w_zc_dlz：全部打印可明确包含零科目；默认空账仍阻止打印', async () => {
    const api = app.call(server);
    for (const [kind, account] of [
      ['detail', '1001'],
      ['cash', '1001'],
      ['bank', '100201'],
      ['general', '1001'],
      ['multi', '1002'],
    ] as const) {
      const query = QuerySchema.parse({ kind, account, periodFrom: 202601, periodTo: 202601 });
      expect((await api.report(query)).rows).toEqual([]);
      const report = await api.report({ ...query, includeZero: true });
      expect(report.rows.filter((r) => r.kind === 'opening')).toHaveLength(1);
      expect(report.rows.at(-1)).toMatchObject({ kind: 'closing', signedBalance: 0 });
      const job = await api.print({ ...query, includeZero: true, columns: DEFAULT_COLUMNS });
      expect(job.pages.length).toBeGreaterThan(0);
      expect(job.html).toContain('期初余额');
    }
  });
  it('w_zc_slz：无发生选项保留地址且拒绝错误布尔值', () => {
    expect(parseLedgerUrl({ includeZero: '1' }, 202601, 'detail').query?.includeZero).toBe(true);
    expect(parseLedgerUrl({ includeZero: 'false' }, 202601, 'multi').query?.includeZero).toBe(
      false,
    );
    expect(parseLedgerUrl({ includeZero: 'yes' }, 202601, 'detail').error).toBeTruthy();
  });
});
