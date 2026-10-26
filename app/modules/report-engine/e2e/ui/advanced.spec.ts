import { expect, type Locator, type Page } from '@playwright/test';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report, type ReportSnapshot } from '../../shared';
import { test } from '../../test/shared/e2e-fixture';

const base = {
  account: '1001',
  metric: 'closing' as const,
  unit: 'cents' as const,
  currency: 'CNY',
  direction: 'signed' as const,
  dimension: 'none' as const,
  item: '',
};
async function choose(page: Page, input: Locator, label: string) {
  await input.click();
  const listId = await input.getAttribute('aria-controls');
  expect(listId).toBeTruthy();
  await page
    .locator('.ant-select-dropdown')
    .filter({ has: page.locator(`[id="${listId}"]`) })
    .locator('.ant-select-item-option-content')
    .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .click();
}
async function wizard(page: Page, account: string) {
  await page.getByRole('textbox', { name: 'A1', exact: true }).focus();
  await page.keyboard.press('F8');
  const drawer = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  // 已有公式仍保留在组合编辑中；明确选择结构化总账取数。
  await choose(page, drawer.getByLabel('函数类型', { exact: true }), '总账取数 BALANCE');
  await drawer.getByRole('combobox').first().fill(account);
  await page.keyboard.press('Enter');
  await drawer.getByRole('checkbox', { name: '使用扩展取数口径（第八参数）' }).check();
  return drawer;
}
async function period(page: Page, drawer: Locator, label: string, value: string) {
  await choose(page, drawer.getByLabel(label, { exact: true }), '指定期间 YYYYMM');
  await drawer.getByLabel(`${label}YYYYMM`, { exact: true }).fill(value);
}
async function save(page: Page, revision = 2) {
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(new RegExp(`版本 ${revision} · 已保存`))).toBeVisible();
}

test('w_bb_def_help 第八参数真实闭区间取数，保存重开后生成314分且禁止错误穿透', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, (svc) =>
    seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 103 },
          { account: '6001', credit: 103 },
        ],
      },
      {
        date: '2026-02-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 211 },
          { account: '6001', credit: 211 },
        ],
      },
    ]).then(() => {}),
  );
  const r = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    emptyTemplate({ code: '101', name: '扩展闭区间', rows: 1, cols: 1 }),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const drawer = await wizard(page, '1001');
  await choose(page, drawer.getByLabel('期间口径'), '本期借方发生');
  await period(page, drawer, '取数开始期间', '202601');
  await period(page, drawer, '取数结束期间', '202602');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  const source = balanceFormula({
    ...base,
    metric: 'debit',
    options: { from: '202601', to: '202602', closing: 'include', side: 'net', groupBy: [] },
  });
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(source);
  await save(page);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(source);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202602`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '314',
  );
  await expect(page.getByRole('link', { name: /A1 查看科目/ })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'A1 明细穿透已暂停' })).toContainText(
    '扩展 options',
  );
});

test('w_bb_def_help 余额不允许排除结转，改发生额后excludePnl只排pnl且保留自定义转账', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    for (const [closingKind, amount] of [
      [null, 103],
      ['pnl', 211],
      ['period-close:001', 307],
    ] as const) {
      const v = await svc.vouchers.create({
        ...(await voucherInputFromSpec(svc, {
          date: '2026-01-05',
          lines: [
            { account: '6001', debit: amount },
            { account: '4103', credit: amount },
          ],
        })),
        closingKind,
      });
      await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
      await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
    }
  });
  const r = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    emptyTemplate({ code: '101', name: '真实结转口径', rows: 1, cols: 1 }),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const drawer = await wizard(page, '6001');
  await choose(page, drawer.getByLabel('结转口径', { exact: true }), '仅发生额：排除损益结转 pnl');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: '排除结转仅支持发生额' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('');
  await choose(page, drawer.getByLabel('期间口径'), '本期借方发生');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await save(page);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '410',
  );
});

test('w_bb_def_help 按客供分组取正借方，10001与贷6003不先抵销成3998', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await svc.dimensions.create({ type: 'partner', code: 'C002', name: '另一客户' });
    await seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1122', debit: 10001, dims: { partner: 'C001' } },
          { account: '4001', credit: 10001 },
        ],
      },
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1122', credit: 6003, dims: { partner: 'C002' } },
          { account: '4001', debit: 6003 },
        ],
      },
    ]);
  });
  const template = emptyTemplate({ code: '101', name: '辅助分组重分类', rows: 2, cols: 1 });
  template.cells = [
    {
      address: 'A2',
      source: balanceFormula({ ...base, account: '1122' }),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const drawer = await wizard(page, '1122');
  await choose(
    page,
    drawer.getByLabel('余额分向', { exact: true }),
    '逐末级及辅助分组取正借方余额',
  );
  await choose(page, drawer.getByLabel('辅助分组', { exact: true }), '客户/供应商');
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await save(page);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '10001',
  );
  await expect(page.getByTestId('result-A2').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '3998',
  );
});

test('w_bb_def_help IF/MAX示例有真实入口，区域参数被拒绝，惰性分支不执行除零', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request);
  const template = emptyTemplate({ code: '101', name: '惰性条件取数', rows: 2, cols: 2 });
  template.cells = [
    { address: 'A1', source: '-55', kind: 'money', unit: 'cents', currency: 'CNY' },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('textbox', { name: 'B1', exact: true }).focus();
  await page.keyboard.press('F8');
  const drawer = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  await choose(page, drawer.getByLabel('函数类型', { exact: true }), '组合公式/比较/IF/MAX');
  const expression = drawer.getByLabel('组合公式', { exact: true });
  await drawer.getByRole('button', { name: '插入 IF 示例' }).click();
  await expect(expression).toHaveValue('IF(A1>0,A1,0)');
  await expression.fill('');
  await drawer.getByRole('button', { name: '插入 MAX 示例' }).click();
  await expect(expression).toHaveValue('MAX(A1,0)');
  await expression.fill('MAX(A1:A2)');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(
    drawer.getByRole('alert').filter({ hasText: 'MAX 至少需要一个数值或单元格参数' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue('');
  await expression.fill('IF(A1>0,1/0,MAX(-A1,0))');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await save(page);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(page.getByTestId('result-B1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '55',
  );
});

test('w_bb_proc 扩展期间未建立时真实拒绝，保留原成功快照和旧整数金额', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 103 },
          { account: '6001', credit: 103 },
        ],
      },
    ]);
  });
  const template = emptyTemplate({ code: '101', name: '缺期拒绝', rows: 1, cols: 1 });
  template.cells = [
    {
      address: 'A1',
      source: balanceFormula(base),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  const original = await callApi<{ snapshot: ReportSnapshot }>(
    isolated.request,
    'm.report-engine.generate',
    { id: r.id, expectedRevision: r.revision, period: 202601, requestId: crypto.randomUUID() },
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const drawer = await wizard(page, '1001');
  await period(page, drawer, '取数开始期间', '202701');
  await period(page, drawer, '取数结束期间', '202701');
  await drawer.getByRole('button', { name: '插入到当前单元格' }).click();
  await save(page);
  await page.goto(`${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202601`);
  await page.getByRole('button', { name: '生成/重算' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '失败操作不会覆盖上次成功结果。' }),
  ).toContainText(/没有建立|早于/);
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '103',
  );
  const after = await callApi<ReportSnapshot>(
    isolated.request,
    'm.report-engine.snapshot',
    { id: r.id, period: 202601 },
    { token, method: 'GET' },
  );
  expect(after.id).toBe(original.snapshot.id);
});

test('w_bb_proc 取数延伸到未来月份时提示实际检查并跳到该月未过账凭证', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-03-05',
        status: 'pending',
        lines: [
          { account: '1001', debit: 37 },
          { account: '6001', credit: 37 },
        ],
      },
    ]);
  });
  const template = emptyTemplate({ code: '101', name: '未来期间确认', rows: 1, cols: 1 });
  template.cells = [
    {
      address: 'A1',
      source: balanceFormula({
        ...base,
        metric: 'debit',
        options: { from: '202603', to: '202603' },
      }),
      kind: 'formula',
      unit: 'cents',
      currency: 'CNY',
    },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', template, {
    token,
    method: 'POST',
  });
  await page.goto(
    `${isolated.baseURL}/m/report-engine/view?id=${r.id}&period=202602&includeUnposted=true`,
  );
  await page.getByRole('button', { name: '生成/重算' }).click();
  const confirm = page.getByRole('dialog', { name: '生成前发现未过账凭证' });
  await expect(confirm).toContainText('本次生成检查发现 1 张未过账凭证');
  await expect(confirm.getByRole('link', { name: '待审核凭证' })).toHaveAttribute(
    'href',
    '/m/voucher-book?period=202603&status=pending',
  );
  await expect(page.getByTestId('result-A1')).toHaveCount(0);
  await confirm.getByRole('button', { name: '按所选口径继续生成' }).click();
  await expect(page.getByTestId('result-A1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '37',
  );
});
