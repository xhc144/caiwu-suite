import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestApp, seedVouchers } from '@caiwu/testkit';
import reportServer from '../../server';
import { balanceFormula, emptyTemplate } from '../../shared';

it('w_bb_proc 当前和未来均有未过账时，首次确认数量/入口必须覆盖最终成功快照的范围', async () => {
  const app = await createTestApp({ modules: [reportServer] });
  try {
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'pending',
        lines: [
          { account: '1001', debit: 17 },
          { account: '6001', credit: 17 },
        ],
      },
      {
        date: '2026-03-05',
        status: 'pending',
        lines: [
          { account: '1001', debit: 37 },
          { account: '6001', credit: 37 },
        ],
      },
    ]);
    const api = app.call(reportServer);
    const template = emptyTemplate({ code: '101', name: '扩展确认范围', rows: 1, cols: 1 });
    template.cells = [
      {
        address: 'A1',
        kind: 'formula',
        unit: 'cents',
        currency: 'CNY',
        source: balanceFormula({
          account: '1001',
          metric: 'debit',
          unit: 'cents',
          currency: 'CNY',
          direction: 'signed',
          dimension: 'none',
          item: '',
          options: { from: '202603', to: '202603' },
        }),
      },
    ];
    const report = await api.importTemplate(template);
    const input = {
      id: report.id,
      expectedRevision: report.revision,
      period: 202602,
      includeUnposted: true,
      requestId: randomUUID(),
    };
    const confirmation = await api.generate(input);
    if (confirmation.kind !== 'confirmation') throw new Error('生成前必须确认未过账');
    expect(await api.snapshot({ id: report.id, period: 202602, includeUnposted: true })).toBeNull();
    const generated = await api.generate({ ...input, confirmUnposted: true });
    if (generated.kind !== 'generated') throw new Error('确认后应真实生成结果');
    expect(generated.snapshot.cells[0]!.value).toBe('37');
    expect(confirmation.count).toBe(generated.snapshot.unpostedCount);
    expect(confirmation.links).toContainEqual({
      label: '待审核凭证',
      to: '/m/voucher-book?period=202603&status=pending',
    });
  } finally {
    await app.close();
  }
});
