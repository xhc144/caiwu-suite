import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { seedVouchers } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report, ReportSnapshot } from '../../shared';
import { activity402ClassifiedTemplate } from '../../templates/nonprofit/activity-classified';
import { classifiedMapping } from '../../test/nonprofit/activity-classified-fixture';
import { test } from './fixture';

test('直接HTTP：民非402完整专用来源正例后，410101混入限定500拒绝重算/回放/导出，旧快照保留', async ({
  nonprofit,
}) => {
  const bookId = await nonprofit.createBook('classified');
  const { token } = await callApi<{ token: string }>(nonprofit.request, 'core.auth.login', {
    bookId,
    userCode: 'admin',
    password: 'admin',
  });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(nonprofit.request, `m.report-engine.${name}`, input, { token, method: 'POST' });
  const get = <T>(name: string, input: unknown) =>
    callApi<T>(nonprofit.request, `m.report-engine.${name}`, input, { token, method: 'GET' });
  const report = await post<Report>(
    'importTemplate',
    activity402ClassifiedTemplate(classifiedMapping()),
  );
  const input = { id: report.id, expectedRevision: 1, period: 202602, requestId: randomUUID() };
  const before = await post<{ snapshot: ReportSnapshot }>('generate', input);
  expect(before.snapshot.checks.every((c) => c.status === 'pass')).toBe(true);
  expect(before.snapshot.cells.find((c) => c.address === 'E6')?.value).toBe('925');
  expect(await get('exportResult', { id: report.id, period: 202602 })).toBeTruthy();
  await nonprofit.withCore(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-02-20',
        status: 'posted',
        summary: '虚构限定资源500混入非限定专用末级',
        lines: [
          { account: '1122', debit: 500 },
          { account: '410101', credit: 500 },
        ],
      },
    ]);
  });
  for (const requestId of [input.requestId, randomUUID()])
    await expect(post('generate', { ...input, requestId })).rejects.toThrow(
      /重新逐笔确认|来源.*变更/,
    );
  await expect(get('exportResult', { id: report.id, period: 202602 })).rejects.toThrow(
    /重新逐笔确认|来源.*变更/,
  );
  const old = await get<ReportSnapshot>('snapshot', { id: report.id, period: 202602 });
  expect(old.id).toBe(before.snapshot.id);
  expect(old.cells.find((c) => c.address === 'E6')?.value).toBe('925');
});
