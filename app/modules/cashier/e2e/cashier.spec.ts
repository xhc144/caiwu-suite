import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import { formatMoney } from '@caiwu/core';
import { test, expect } from './fixture';
import {
  bankBook,
  documents,
  postGenerated,
  postedBook,
  receipts,
  reconciliation,
  recordThree,
} from './scenarios';

// 保持默认每例 30s。可见页面/保存/生成/勾账分别须在 5s 内反馈，
// 防止拆分长链后掩盖真实的用户等待或查询阻塞。
const feedback = { timeout: 5000 };

test('出纳启用：页面建银行账户及一致期初，重复进入保留配置', async ({ cashier }) => {
  const { page, request, withServices } = cashier;
  const book = await loginWithNewBook(page, request, { product: 'chengben' });
  await test.step(
    '账户页面在5秒内可用',
    async () => {
      await page.goto('/m/cashier/accounts');
      await expect(page.getByRole('heading', { name: '出纳账户与期初' })).toBeVisible();
    },
    feedback,
  );
  await test.step(
    '启用状态在5秒内持久化并显示',
    async () => {
      await page.getByRole('button', { name: '保存启用状态' }).click();
      await expect(page.getByText('出纳已启用：202601；历史数据已保留')).toBeVisible();
    },
    feedback,
  );
  await page.getByRole('button', { name: '新增账户', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增出纳账户' });
  await drawer.getByLabel('账户名称').fill('闭环银行');
  await drawer.getByLabel('关联现金银行科目').fill('100201');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('出纳期初（借正贷负）').fill('1000');
  await test.step(
    '账户保存在5秒内反馈',
    async () => {
      await drawer.getByRole('button', { name: '保存账户' }).click();
      await expect(drawer).not.toBeVisible();
      await expect(page.getByRole('row', { name: /闭环银行/ })).toContainText('1,000.00');
    },
    feedback,
  );
  await withServices(book.bookId, async (svc) => {
    await svc.opening.upsert({
      year: 2026,
      accountId: (await svc.accounts.require('100201')).id,
      balance: 100000,
    });
  });
  await callApi(request, 'm.cashier.enable', { period: 202601 }, { token: book.token });
  await test.step(
    '重新进入核对期初在5秒内显示',
    async () => {
      await page.reload();
      const row = page.getByRole('row', { name: /闭环银行/ });
      await expect(row).toContainText('1,000.00');
      await expect(row).toContainText('0.00');
    },
    feedback,
  );
  const saved = await callApi<{ opening: number; coreOpening: number }[]>(
    request,
    'm.cashier.accounts',
    {},
    { token: book.token, method: 'GET' },
  );
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ opening: 100000, coreOpening: 100000 });
});

test('出纳录入：页面连续录3笔银行收付，方向、金额、辅助项真实保存', async ({ cashier }) => {
  const book = await bankBook(cashier);
  const { page } = cashier;
  await test.step(
    '收付单页面在5秒内可用',
    async () => {
      await page.goto('/m/cashier/documents');
      await expect(page.getByRole('button', { name: '新增收付单' })).toBeVisible();
    },
    feedback,
  );
  for (const row of receipts) {
    await page.getByRole('button', { name: '新增收付单' }).click();
    const drawer = page.getByRole('dialog', { name: '新增收付单' });
    await drawer.getByLabel('出纳账户').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('日期', { exact: true }).fill('2026-01-10');
    await drawer.getByLabel('摘要', { exact: true }).fill(row.summary);
    await drawer.getByLabel('收付方向').click();
    if (row.direction === 'payment') await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await drawer
      .getByLabel('金额', { exact: true })
      .fill(formatMoney(row.amount, { thousands: false }));
    await drawer.getByLabel('对方科目', { exact: true }).fill('6603');
    await page.keyboard.press('Enter');
    await drawer.getByLabel('现金流量项目', { exact: true }).fill('CF01');
    await page.keyboard.press('Enter');
    await test.step(
      `${row.summary}保存须在5秒内反馈`,
      async () => {
        await drawer.getByRole('button', { name: '保存收付单' }).click();
        await expect(drawer).not.toBeVisible();
        await expect(page.getByRole('row', { name: new RegExp(row.summary) })).toContainText(
          formatMoney(row.amount),
        );
      },
      feedback,
    );
  }
  const rows = await documents(cashier, book);
  expect(
    rows.map((d) => [
      d.number,
      d.summary,
      d.amount,
      d.direction,
      d.dimensions.cashflow,
      d.voucherId,
    ]),
  ).toEqual(
    receipts.map((d, i) => [
      `CN-00000${i + 1}`,
      d.summary,
      d.amount,
      d.direction,
      book.cashflow,
      null,
    ]),
  );
  expect((await reconciliation(cashier, book)).adjustment).toMatchObject({
    cashBalance: 114500,
    cashOutstanding: 14500,
  });
});

for (const mode of ['individual', 'summary'] as const) {
  test(`出纳凭证：${mode}真实3单预览→生成→来源锁→core过账后可读`, async ({ cashier }) => {
    const book = await bankBook(cashier);
    await recordThree(cashier, book);
    const { page } = cashier;
    const previewRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('m.cashier.preview')) previewRequests.push(request.url());
    });
    await test.step(
      '待生成单据在5秒内显示',
      async () => {
        await page.goto('/m/cashier/documents');
        await expect(page.getByRole('row', { name: /客户到账/ })).toBeVisible();
      },
      feedback,
    );
    await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
    await page.getByRole('button', { name: '生成凭证预览' }).click();
    const drawer = page.getByRole('dialog', { name: '凭证生成预览' });
    if (mode === 'summary') {
      await drawer.getByLabel('方式').click();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }
    await test.step(
      '真实分录预览在5秒内反馈',
      async () => {
        await drawer.getByRole('button', { name: '预览分录' }).click();
        await expect(drawer.getByRole('row', { name: /银行存款/ })).toHaveCount(3);
      },
      feedback,
    );
    await test.step(
      '生成及来源锁定在5秒内反馈',
      async () => {
        await drawer.getByRole('button', { name: '确认生成待审核凭证' }).click();
        await expect(drawer).not.toBeVisible();
        await expect(page.getByText('来源锁定', { exact: true })).toHaveCount(3);
      },
      feedback,
    );
    const before = await reconciliation(cashier, book);
    expect(before.entries).toHaveLength(0);
    await postGenerated(cashier, book, mode === 'individual' ? 3 : 1);
    const rows = await documents(cashier, book);
    expect(rows.every((d) => d.voucherStatus === 'posted')).toBe(true);
    expect(previewRequests, '生成成功后的列表刷新不能重新提交旧版本预览').toHaveLength(1);
  });
}

test('出纳对账：真实3单来源凭证已过账→手动勾账→余额调节→取消恢复未达', async ({ cashier }) => {
  const book = await postedBook(cashier);
  const { page } = cashier;
  await test.step(
    '财务分录与余额调节在5秒内可读',
    async () => {
      await page.goto('/m/cashier/reconcile');
      await expect(page.getByRole('heading', { name: '和账务对账', exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,290.00');
      await expect(page.getByText('期初差额：0.00；调节后差额：0.00')).toBeVisible();
    },
    feedback,
  );
  await test.step(
    '刷新财务分录在5秒内反馈',
    async () => {
      const response = page.waitForResponse(
        (r) => r.url().includes('m.cashier.reconcile') && r.request().method() === 'GET',
      );
      await page.getByRole('button', { name: '刷新财务分录' }).click();
      expect((await response).ok()).toBe(true);
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,290.00');
    },
    feedback,
  );
  const selectAll = page.getByRole('checkbox', { name: 'Select all', exact: true });
  await expect(selectAll).toHaveCount(2);
  await selectAll.nth(0).check();
  await selectAll.nth(1).check();
  await page.getByRole('button', { name: '确认手动勾账' }).click();
  const confirm = page.getByRole('dialog', { name: '确认手动等额勾账' });
  await confirm.getByLabel('确认文字').fill('勾账');
  await test.step(
    '勾账与调节后余额在5秒内反馈',
    async () => {
      await confirm.getByRole('button', { name: '确定' }).click();
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).toBeVisible();
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,145.00');
      await expect(page.getByText('出纳未达项')).toBeVisible();
    },
    feedback,
  );
  const matched = await reconciliation(cashier, book);
  expect(matched.groups).toHaveLength(1);
  expect(matched.groups[0]!.valid).toBe(true);
  expect(matched.documents.every((d) => d.matchId === matched.groups[0]!.id)).toBe(true);
  expect(matched.entries.every((e) => e.matchId === matched.groups[0]!.id)).toBe(true);
  expect(matched.adjustment).toMatchObject({
    cashBalance: 114500,
    coreBalance: 114500,
    cashOutstanding: 0,
    coreOutstanding: 0,
    difference: 0,
  });
  await page.getByRole('button', { name: '取消勾账', exact: true }).click();
  const cancel = page.getByRole('dialog', { name: `取消勾账组 ${matched.groups[0]!.id}` });
  await cancel.getByLabel('确认文字').fill('取消勾账');
  await test.step(
    '取消后未达与余额在5秒内恢复',
    async () => {
      await cancel.getByRole('button', { name: '确定' }).click();
      await expect(page.getByRole('button', { name: '取消勾账', exact: true })).not.toBeVisible();
      await expect(page.getByRole('row', { name: /调节后余额/ })).toContainText('1,290.00');
    },
    feedback,
  );
  const restored = await reconciliation(cashier, book);
  expect(restored.groups).toHaveLength(0);
  expect(restored.adjustment).toMatchObject({
    cashBalance: 114500,
    coreBalance: 114500,
    cashOutstanding: 14500,
    coreOutstanding: 14500,
    difference: 0,
  });
  expect(restored.adjustment.cashOutstandingIds).toHaveLength(3);
  expect(restored.adjustment.coreOutstandingIds).toHaveLength(3);
  // 跨模块只检查导航 URL，不以目标模块作为前置。
  await page.getByRole('button', { name: '记-0001', exact: true }).click();
  await expect(page).toHaveURL(/\/m\/voucher-entry\/edit\?id=/);
});
