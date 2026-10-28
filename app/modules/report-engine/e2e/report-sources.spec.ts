import { expect } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

test('w_bb_proc 逐项取数展示累计和辅助口径，真实穿透保留条件且排除其他客户', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      summary: '客户甲合成一月应收',
      status: 'posted',
      lines: [
        { account: '1122', debit: 5000, dims: { partner: 'C001' } },
        { account: '6001', credit: 5000 },
      ],
    },
    {
      date: '2026-02-05',
      summary: '客户甲合成二月应收',
      status: 'posted',
      lines: [
        { account: '1122', debit: 1000, dims: { partner: 'C001' } },
        { account: '6001', credit: 1000 },
      ],
    },
    {
      date: '2026-01-06',
      summary: '客户乙合成无关应收',
      status: 'posted',
      lines: [
        { account: '1122', debit: 7000, dims: { partner: 'S001' } },
        { account: '6001', credit: 7000 },
      ],
    },
  ]);
  const template = emptyTemplate({ code: '101', name: '合成辅助来源穿透', rows: 2, cols: 2 });
  template.cells = [
    {
      address: 'A1',
      kind: 'formula',
      source: balanceFormula({
        account: '1122',
        metric: 'ytdDebit',
        unit: 'cents',
        currency: 'CNY',
        direction: 'signed',
        dimension: 'partner',
        item: 'C001',
      }),
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    template,
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${report.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  const sources = page.getByRole('table', { name: '逐项取数来源' });
  await expect(sources).toContainText('本年累计借方');
  await expect(sources).toContainText('202601至202602');
  await expect(sources).toContainText('C001 / CNY');
  await expect(sources).toContainText('60.00');
  const link = sources.getByRole('link', { name: 'A1 查看科目 1122 明细' });
  const query = new URL((await link.getAttribute('href'))!, isolated.baseURL).searchParams;
  const dims = JSON.parse(query.get('dims')!) as { partner: number };
  expect(dims.partner).toBeGreaterThan(0);
  const request = page.waitForRequest((r) => r.url().includes('m.ledgers.report'));
  await link.click();
  const raw = JSON.parse(new URL((await request).url()).searchParams.get('input')!);
  const input = Object.values(raw).find(
    (value) => typeof value === 'object' && value && 'account' in value,
  ) as { account: string; periodFrom: number; periodTo: number; dimensions: { partner: number } };
  expect(input).toMatchObject({
    account: '1122',
    periodFrom: 202601,
    periodTo: 202602,
    dimensions: dims,
  });
  await expect(page.getByText('客户甲合成一月应收', { exact: true })).toBeVisible();
  await expect(page.getByText('客户甲合成二月应收', { exact: true })).toBeVisible();
  await expect(page.getByText('客户乙合成无关应收', { exact: true })).toHaveCount(0);
});
