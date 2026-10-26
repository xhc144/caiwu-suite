import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { seedVouchers } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot, ReportTemplate } from '../../shared';
import { extendedBalanceSheetTemplate } from '../../templates/small-business/extended';
import { officialInventoryMapping } from '../../templates/small-business/inventory-balance';
import { seedInventoryBook } from '../../test/small-business/inventory-fixture';
import { loginSmallBook, test } from './fixture';

for (const role of ['absent1421', 'frozenLeaves'] as const)
  test(`直接HTTP小企${role}：旧profile拒绝真实新增，母科目动态包含且重新确认后恢复`, async ({
    page,
    isolatedSmall,
  }) => {
    const { bookId, token } = await loginSmallBook(page, isolatedSmall.request);
    const post = <T>(name: string, input: unknown) =>
      callApi<T>(isolatedSmall.request, `m.report-engine.${name}`, input, {
        token,
        method: 'POST',
      });
    const get = <T>(name: string, input: unknown) =>
      callApi<T>(isolatedSmall.request, `m.report-engine.${name}`, input, { token, method: 'GET' });
    let template: ReportTemplate | undefined;
    await isolatedSmall.withCore(bookId, async (svc) => {
      await svc.periods.ensureYear(2026);
      if (role === 'absent1421')
        await svc.db.deleteFrom('account').where('code', '=', '1421').execute();
      else await seedInventoryBook(svc);
      template = extendedBalanceSheetTemplate({
        period: 202602,
        accounts: await svc.accounts.list(),
        mapping: {
          ...officialInventoryMapping,
          ...(role === 'absent1421'
            ? {
                consumableBiologicalAssets: {
                  absent: { reason: '已完整核对合成科目表及业务，无1421' },
                },
              }
            : { rawMaterials: { accounts: ['140301', '140302'] } }),
        },
      });
    });
    const r = await post<Report>('importTemplate', template);
    const input = { id: r.id, expectedRevision: 1, period: 202602, requestId: randomUUID() };
    const before = await post<{ snapshot: ReportSnapshot }>('generate', input);
    expect(before.snapshot.cells.find((c) => c.address === 'C14')?.value).toBe(
      role === 'absent1421' ? '0' : '28688',
    );
    await isolatedSmall.withCore(bookId, async (svc) => {
      const code = role === 'absent1421' ? '1421' : '140303';
      await svc.accounts.create(
        { code, name: '合成新增来源', ...(role === 'absent1421' ? { categoryId: 'asset' } : {}) },
        [4, 2, 2],
      );
      const amount = role === 'absent1421' ? 12345 : 777;
      await seedVouchers(svc, [
        {
          date: '2026-02-12',
          status: 'posted',
          lines: [
            { account: code, debit: amount },
            { account: '3001', credit: amount },
          ],
        },
      ]);
    });
    for (const requestId of [input.requestId, randomUUID()])
      await expect(post('generate', { ...input, requestId })).rejects.toThrow(
        /profile|完整覆盖|仍然存在/,
      );
    await expect(get('exportResult', { id: r.id, period: 202602 })).rejects.toThrow(
      /profile|完整覆盖|仍然存在/,
    );
    expect((await get<ReportSnapshot>('snapshot', { id: r.id, period: 202602 })).id).toBe(
      before.snapshot.id,
    );
    const live = extendedBalanceSheetTemplate();
    live.code = '311';
    const dynamic = await post<Report>('importTemplate', live);
    const next = await post<{ snapshot: ReportSnapshot }>('generate', {
      ...input,
      id: dynamic.id,
      requestId: randomUUID(),
    });
    expect(next.snapshot.cells.find((c) => c.address === 'C14')?.value).toBe(
      role === 'absent1421' ? '12345' : '29465',
    );
    if (role === 'frozenLeaves')
      expect(next.snapshot.cells.find((c) => c.address === 'C15')?.value).toBe('3565');
    expect(await get('exportResult', { id: dynamic.id, period: 202602 })).toBeTruthy();
  });
