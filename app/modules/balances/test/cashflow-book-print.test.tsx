import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { renderPrintDocument } from '@caiwu/print';
import balancesServer from '../server';
import { buildCashflowPrintJob } from '../web/cashflow-book-print';
import { defaultCashflowSettings } from '../cashflow';
import { seedCashflowCases, seedFlow } from './cashflow-fixtures';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [balancesServer] });
});
afterEach(async () => app.close());

it('w_zc_xjll_1 核对、项目汇总和完整凭证/科目分册，真实现金流量逐分保留且页码连续', async () => {
  await seedCashflowCases(app.svc);
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  const job = buildCashflowPrintJob(report, defaultCashflowSettings.display, true);
  const doc = new DOMParser().parseFromString(renderPrintDocument(job), 'text/html');
  const pages = [...doc.querySelectorAll('.cashflow-sheet')];
  expect(pages.length).toBeGreaterThanOrEqual(10);
  pages.forEach((page, index) => {
    expect(page.getAttribute('data-page')).toBe(String(index + 1));
    expect(page.querySelector('footer')!.textContent).toBe(`第 ${index + 1} 页`);
    expect(page.textContent).toContain('202602');
    expect(page.textContent).toContain('金额单位：元');
    expect(page.querySelector('thead')).not.toBeNull();
  });
  for (const row of report.rows)
    expect(doc.querySelectorAll(`[data-line="${row.lineId}"][data-fragment="0"]`)).toHaveLength(2);
  expect(job.html).toContain('244.10');
  expect(job.html).toContain('现金银行内部互转');
  expect(job.html).toContain('未分配');
  expect(job.html).toContain('科目编码');
  expect(job.html).toContain('科目名称');
});

it('w_zc_xjll_1 长摘要跨页不丢字，承前/过次页累计与分录累计区分，金额极值保持精确文本', async () => {
  const summary = '甲乙丙丁'.repeat(49) + '完结';
  await seedVouchers(
    app.svc,
    Array.from({ length: 6 }, (_, index) => ({
      date: '2026-02-01',
      status: 'posted',
      lines: [
        { account: '1001', debit: index === 0 ? 9007199254740901 : 1, summary },
        { account: '4001', credit: index === 0 ? 9007199254740901 : 1 },
      ],
    })),
  );
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  const job = buildCashflowPrintJob(report, defaultCashflowSettings.display);
  const doc = new DOMParser().parseFromString(renderPrintDocument(job), 'text/html');
  const detail = [...doc.querySelectorAll(`.cashflow-sheet`)].filter(
    (p) => p.querySelector('h2')!.textContent === '项目明细 · 凭证与收付',
  );
  const restored = detail
    .flatMap((p) => [
      ...p.querySelectorAll(`[data-line="${report.rows[0]!.lineId}"] td:nth-child(4)`),
    ])
    .map((c) => c.textContent)
    .join('');
  expect(restored).toBe(summary);
  expect(detail.length).toBeGreaterThan(1);
  expect(job.html).toContain('90071992547409.01');
  expect(job.html).toContain('承前页');
  expect(job.html).toContain('过次页');
  expect(job.html).toContain('分录净额累计按日期计算');
});

it('w_zc_xjll_1 隐藏科目格式仅省去科目分册，保留所有凭证、收付和项目', async () => {
  await seedCashflowCases(app.svc);
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  const job = buildCashflowPrintJob(report, {
    ...defaultCashflowSettings.display,
    showAccount: false,
  });
  const doc = new DOMParser().parseFromString(renderPrintDocument(job), 'text/html');
  expect(job.html).not.toContain('科目与收付');
  for (const row of report.rows)
    expect(doc.querySelectorAll(`[data-line="${row.lineId}"][data-fragment="0"]`)).toHaveLength(1);
  expect(job.html).toContain('现金银行净变动');
});

it('w_zc_xjll_1 合法银行互转环净额为零，跨银行打印借贷毛额超过安全整数仍逐分累计', async () => {
  await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CF03',
    name: '合成银行互转',
    attrs: { cashflowDirection: 'internal' },
  });
  const codes = Array.from(
    { length: 15 },
    (_, index) => `1002${String(index + 3).padStart(2, '0')}`,
  );
  for (const code of codes)
    await app.svc.accounts.create(
      { code, name: `合成银行${code}`, isBank: true, cashflowRequired: true },
      [4, 2, 2],
    );
  for (const [index, code] of codes.entries())
    await seedFlow(
      app.svc,
      {
        date: '2026-02-01',
        status: 'posted',
        lines: [
          { account: code, debit: 1000000000000000, dims: { cashflow: 'CF03' } },
          {
            account: codes[(index + 1) % codes.length]!,
            credit: 1000000000000000,
            dims: { cashflow: 'CF03' },
          },
        ],
      },
      ['internal', 'internal'],
    );
  const report = await app
    .call(balancesServer)
    .exportCashflow({ periodFrom: 202602, periodTo: 202602 });
  expect(report).toMatchObject({
    cashOpening: 0,
    cashClosing: 0,
    totals: { cashNet: 0, internalNet: 0 },
    internalUnbalancedVouchers: [],
  });
  const job = buildCashflowPrintJob(report, defaultCashflowSettings.display);
  expect(job.html).toContain('100000000000000.00');
  expect(job.html).toContain('承前页');
  expect(job.html).toContain('过次页');
  expect(() => renderPrintDocument(job)).not.toThrow();
});
