import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import reportServer from '../../server';
import { balanceFormula, emptyTemplate } from '../../shared';

let app: TestApp;
afterEach(async () => app?.close());
describe('w_bb_proc 七/八参数YTD隐含范围', () => {
  it.each(['none', 'cashflow'] as const)(
    '%s取数均验证实际年初范围；补齐后七/八参均为37',
    async (dimension) => {
      app = await createTestApp({ modules: [reportServer], startYear: 2025 });
      await app.svc.periods.ensureYear(2026, { fromMonth: 7 });
      await seedVouchers(app.svc, [
        {
          date: '2026-07-05',
          status: 'posted',
          lines: [
            { account: '1001', debit: 37, dims: { cashflow: 'CF01' } },
            { account: '6001', credit: 37 },
          ],
        },
      ]);
      const api = app.call(reportServer);
      const reports = [];
      for (const [i, options] of [undefined, { closing: 'include' as const }].entries()) {
        const template = emptyTemplate({
          code: String(101 + i),
          name: '累计范围',
          rows: 1,
          cols: 1,
        });
        template.cells = [
          {
            address: 'A1',
            kind: 'formula',
            unit: 'cents',
            currency: 'CNY',
            source: balanceFormula({
              account: '1001',
              metric: 'ytdDebit',
              unit: 'cents',
              currency: 'CNY',
              direction: 'signed',
              dimension,
              item: dimension === 'none' ? '' : 'CF01',
              options,
            }),
          },
        ];
        const r = await api.importTemplate(template);
        reports.push(r);
        await expect(
          api.generate({
            id: r.id,
            expectedRevision: r.revision,
            period: 202607,
            requestId: randomUUID(),
          }),
        ).rejects.toThrow(/还没有建立|累计.*期间|尚未建立/);
        expect(await api.snapshot({ id: r.id, period: 202607 })).toBeNull();
      }
      await app.svc.periods.ensureYear(2026);
      for (const r of reports) {
        const result = await api.generate({
          id: r.id,
          expectedRevision: r.revision,
          period: 202607,
          requestId: randomUUID(),
        });
        expect(result.kind).toBe('generated');
        if (result.kind === 'generated') expect(result.snapshot.cells[0]!.value).toBe('37');
      }
    },
  );
});
