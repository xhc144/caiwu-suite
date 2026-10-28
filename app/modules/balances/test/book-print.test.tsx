import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { renderPrintDocument } from '@caiwu/print';
import balancesServer from '../server';
import { buildBalancePrintJob, defaultBalancePrintOptions } from '../web/book-print';
import { columnsFor } from '../web/output';
import { sumLeaves } from '../server/service';
import { seedAuxiliaryQuantityCases } from './fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());

it.each(['summary', 'foreign', 'quantity'] as const)(
  'w_zw_ye_kmxz %s 专用账册所有列完整成册，重复表头与单位，不混币种、辅助项及数量单位',
  async (mode) => {
    await seedAuxiliaryQuantityCases(app.svc);
    const report = await app.call(balancesServer).export({
      mode,
      dimension: 'department',
      periodFrom: 202602,
      periodTo: 202602,
      codeFrom: '1403',
      codeTo: '1403',
    });
    const job = buildBalancePrintJob(report, -1, []);
    const doc = new DOMParser().parseFromString(renderPrintDocument(job), 'text/html');
    for (const col of columnsFor(report))
      expect([...doc.querySelectorAll('th')].some((th) => th.textContent === col.title)).toBe(true);
    for (const page of doc.querySelectorAll('.balance-sheet')) {
      expect(page.textContent).toContain('202602');
      expect(page.textContent).toContain('单位：');
      expect(page.querySelector('thead')).not.toBeNull();
      expect(page.querySelector('footer')!.textContent).toMatch(/^第 \d+ 页$/);
      if (mode === 'quantity') {
        const text = page.textContent!;
        expect(
          Number(text.includes('数量单位：件')) + Number(text.includes('数量单位：千克')),
        ).toBe(1);
      }
    }
    expect(job.html).toContain(
      mode === 'quantity' ? '2.500003' : mode === 'foreign' ? '71.00' : '91.00',
    );
    expect(doc.querySelectorAll('[data-row="total"][data-fragment="0"]')).toHaveLength(
      report.groups.length * (mode === 'summary' ? 2 : 4),
    );
  },
);

it('w_zw_ye_kmxz 长名称拆行分页不丢字，每页承前/过次只累计已列末级，父行不重复计入', async () => {
  await seedAuxiliaryQuantityCases(app.svc);
  const report = await app
    .call(balancesServer)
    .export({ periodFrom: 202602, periodTo: 202602, codeFrom: '1403', codeTo: '1403' });
  const group = report.groups[0]!;
  const leaf = group.rows.find((r) => r.isLeaf)!;
  const rows = Array.from({ length: 34 }, (_, i) => ({
    ...leaf,
    accountId: i + 1000,
    accountCode: `9${String(i).padStart(3, '0')}`,
    accountName: i === 17 ? '甲乙丙丁'.repeat(30) + '末尾保留' : `合成科目${i}`,
    parentId: null,
    opening: 0,
    debit: 100,
    credit: 0,
    closing: 100,
    ytdDebit: 100,
    ytdCredit: 0,
  }));
  group.rows = rows;
  group.totals = sumLeaves(rows);
  const job = buildBalancePrintJob(report, -1, [], undefined, {
    ...defaultBalancePrintOptions,
    rowsPerPage: 5,
    startPage: 7,
    offsetX: 2,
    offsetY: -1,
  });
  const doc = new DOMParser().parseFromString(renderPrintDocument(job), 'text/html');
  expect(doc.querySelector('.balance-sheet')!.getAttribute('data-page')).toBe('7');
  expect(doc.querySelectorAll('.balance-sheet').length).toBeGreaterThan(14);
  for (const row of rows)
    expect(doc.querySelectorAll(`[data-row="${row.accountId}"][data-fragment="0"]`)).toHaveLength(
      2,
    );
  expect(
    [...doc.querySelectorAll('[data-row="1017"] td:nth-child(2)')]
      .map((td) => td.textContent)
      .join(''),
  ).toContain('甲乙丙丁'.repeat(30) + '末尾保留');
  expect(job.html).toContain('承前页');
  expect(job.html).toContain('过次页');
  expect(doc.querySelector('[data-row="total"]')!.textContent).toContain('34.00');
  expect(job.css).toContain('left:2mm;top:-1mm');
});

it('w_zw_ye_kmxz 指定科目不打印其他科目或范围合计，空选择和越界设置明确阻止', async () => {
  await seedAuxiliaryQuantityCases(app.svc);
  const report = await app.call(balancesServer).export({
    mode: 'quantity',
    periodFrom: 202602,
    periodTo: 202602,
    codeFrom: '1403',
    codeTo: '1403',
  });
  const id =
    report.groups[0]!.rows.find((r) => r.accountCode === '140301')?.accountId ??
    report.groups[1]!.rows.find((r) => r.accountCode === '140301')!.accountId;
  const html = buildBalancePrintJob(report, -1, [], [id]).html;
  expect(html).toContain('不另列选中科目合计');
  expect(html).toContain('140301');
  expect(html).not.toContain('140302');
  expect(html).not.toContain('data-row="total"');
  expect(() => buildBalancePrintJob(report, -1, [], [])).toThrow(/至少选择/);
  expect(() =>
    buildBalancePrintJob(report, -1, [], undefined, { ...defaultBalancePrintOptions, offsetX: 9 }),
  ).toThrow(/打印设置/);
  expect(() => buildBalancePrintJob(report, -1, [], [999999])).toThrow(/没有可打印/);
});

it('w_zw_fhye_1 各辅助余额合法但重排后的跨组毛额超过安全整数，打印精确保留且范围外余额不阻断查询', async () => {
  for (let i = 0; i < 15; i++) {
    const code = `D${i}`;
    await app.svc.dimensions.create({ type: 'department', code, name: `合成部门${i}` });
    await seedVouchers(app.svc, [
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: '6602', debit: 1000000000000000, dims: { department: code } },
          { account: '100201', credit: 1000000000000000 },
        ],
      },
    ]);
  }
  const report = await app.call(balancesServer).export({
    periodFrom: 202602,
    periodTo: 202602,
    codeFrom: '6602',
    codeTo: '6602',
    dimension: 'department',
    dimensionOrder: 'account',
  });
  expect(report.groups).toHaveLength(15);
  expect(report.groups.every((group) => group.totals.debit === 1000000000000000)).toBe(true);
  const job = buildBalancePrintJob(report, -1, []);
  expect(job.html).toContain('150,000,000,000,000.00');
  expect(job.html).toContain('承前页');
  expect(() => renderPrintDocument(job)).not.toThrow();
});
