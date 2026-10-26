import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import type { Account, DimensionItem } from '@caiwu/core';
import type { SavedRow } from '../shared';

test('w_xt_ye_nf/w_xt_xmnc：尾斜杠菜单切换同步真实辅助视图并清除原档案条件', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  const data = await callApi<{ accounts: Account[]; items: DimensionItem[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const department = data.items.find((i) => i.typeId === 'department' && i.code === '01')!.id;
  const project = data.items.find((i) => i.typeId === 'project' && i.code === 'XM01')!.id;
  await callApi(
    request,
    'm.opening.save',
    {
      year: 2026,
      changes: [
        {
          data: {
            year: 2026,
            accountId: data.accounts.find((a) => a.code === '6602')!.id,
            dimensions: { department },
            balance: 101,
          },
        },
        {
          data: {
            year: 2026,
            accountId: data.accounts.find((a) => a.code === '5001')!.id,
            dimensions: { project },
            balance: 202,
          },
        },
      ],
    },
    { token },
  );
  await page.goto(`/m/opening/?year=2026&dimension=department&item=${department}`);
  const details = page.locator('.cw-data-table:visible').nth(1);
  await expect(details).toContainText('部门：01');
  await page.getByRole('menuitem', { name: '项目期初录入', exact: true }).click();
  await expect(page).toHaveURL(/dimension=project/);
  await expect(page.getByLabel('项目筛选', { exact: true })).toBeVisible();
  await expect(page.getByLabel('部门筛选', { exact: true })).not.toBeVisible();
  await expect(details).toContainText('项目：XM01');
  await expect(details).not.toContainText('部门：01');
  expect(new URL(page.url()).searchParams.get('item')).toBeNull();
});

test('w_xt_bmnc/w_xt_bm_sc：编码/拼音查部门、重载保持范围、新增带入所选部门，切换辅助类型清除原条件', async ({
  page,
  request,
}) => {
  const { token } = await loginWithNewBook(page, request);
  const data = await callApi<{ accounts: Account[]; items: DimensionItem[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const department = data.accounts.find((a) => a.code === '6602')!.id;
  const one = data.items.find((i) => i.typeId === 'department' && i.code === '01')!.id;
  const two = data.items.find((i) => i.typeId === 'department' && i.code === '02')!.id;
  await callApi(
    request,
    'm.opening.save',
    {
      year: 2026,
      changes: [
        {
          data: {
            year: 2026,
            accountId: department,
            dimensions: { department: one },
            balance: 101,
          },
        },
        {
          data: {
            year: 2026,
            accountId: department,
            dimensions: { department: two },
            balance: 202,
          },
        },
      ],
    },
    { token },
  );
  await page.goto('/m/opening?year=2026&dimension=department');
  const details = page.locator('.cw-data-table:visible').nth(1);
  await expect(details.getByRole('row')).toHaveCount(3);
  await page.getByLabel('部门筛选', { exact: true }).fill('xzb');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`item=${one}`));
  await expect(details.getByRole('row')).toHaveCount(2);
  await expect(details).toContainText('部门：01 行政部');
  await expect(details).not.toContainText('部门：02');
  await page.reload();
  await expect(details.getByRole('row')).toHaveCount(2);
  await page.getByRole('button', { name: '新增期初', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增期初', exact: true });
  await drawer.getByLabel('末级科目', { exact: true }).fill('6602');
  await page.keyboard.press('Enter');
  await expect(drawer.locator('.ant-select').filter({ hasText: '01 行政部' })).toBeVisible();
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('9.99');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  await expect(drawer).toContainText('重复');
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('9.99');
  await drawer
    .locator('.ant-drawer-footer')
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '有未保存修改', exact: true })
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  // 等抽屉和确认框真正结束退场及焦点归还，避免它们关闭新打开的 Select。
  await expect(page.locator('.ant-drawer:visible, .ant-modal:visible')).toHaveCount(0);
  await page.getByLabel('期初视图', { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .filter({ hasText: /^项目期初$/ })
    .click();
  await expect(page).toHaveURL(/dimension=project/);
  expect(new URL(page.url()).searchParams.get('item')).toBeNull();
  await expect(page.getByLabel('项目筛选', { exact: true })).toBeVisible();
  const saved = await callApi<{ rows: SavedRow[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  expect(saved.rows.map((r) => r.balance)).toEqual([101, 202]);
});

test('w_xt_ye/m_work_xt_01/m_work_xt_fznc：真实打印预览、原生打印事件、过滤后PDF，未保存输入禁止输出', async ({
  page,
  request,
  context,
}, info) => {
  const { token } = await loginWithNewBook(page, request, { startMonth: 7 });
  const data = await callApi<{ accounts: Account[]; items: DimensionItem[] }>(
    request,
    'm.opening.list',
    { year: 2026 },
    { token, method: 'GET' },
  );
  const department = data.accounts.find((a) => a.code === '6602')!.id;
  const one = data.items.find((i) => i.typeId === 'department' && i.code === '01')!.id;
  const two = data.items.find((i) => i.typeId === 'department' && i.code === '02')!.id;
  await callApi(
    request,
    'm.opening.save',
    {
      year: 2026,
      changes: [
        {
          data: {
            year: 2026,
            accountId: department,
            dimensions: { department: one },
            balance: 10000,
            ytdDebit: -1,
          },
        },
        {
          data: {
            year: 2026,
            accountId: department,
            dimensions: { department: two },
            balance: 202,
          },
        },
      ],
    },
    { token },
  );
  await page.goto(`/m/opening?year=2026&dimension=department&item=${one}`);
  await expect(page.getByRole('heading', { name: '期初余额', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打印预览', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+p');
  const modal = page.getByRole('dialog', { name: '期初余额打印预览', exact: true });
  const frame = modal.frameLocator('iframe[title="期初余额打印内容"]');
  await expect(frame.locator('h1')).toHaveText('2026 年部门期初余额');
  await expect(frame.locator('tbody tr')).toHaveCount(1);
  await expect(frame.locator('body')).toContainText('01 行政部');
  await expect(frame.locator('body')).not.toContainText('02 销售部');
  await expect(frame.locator('tbody')).toContainText('100.01');
  await expect(frame.locator('tbody')).toContainText('-0.01');
  const html = (await modal.locator('iframe').getAttribute('srcdoc'))!;
  await page.evaluate(() => {
    const captured: { phase: string; trusted: boolean; text: string }[] = [];
    (window as unknown as { openingPrintEvents: typeof captured }).openingPrintEvents = captured;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (
            !(node instanceof HTMLIFrameElement) ||
            node.getAttribute('aria-label') !== '系统打印'
          )
            continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(phase, (event) => {
                  captured.push({
                    phase,
                    trusted: event.isTrusted,
                    text: node.contentDocument!.body.textContent!,
                  });
                });
            },
            { capture: true, once: true },
          );
        }
    });
    observer.observe(document.body, { childList: true });
  });
  await modal.getByRole('button', { name: '打印', exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { openingPrintEvents: { phase: string }[] }).openingPrintEvents.map(
          (e) => e.phase,
        ),
      ),
    )
    .toEqual(['beforeprint', 'afterprint']);
  const events = await page.evaluate(
    () =>
      (window as unknown as { openingPrintEvents: { trusted: boolean; text: string }[] })
        .openingPrintEvents,
  );
  expect(
    events.every(
      (event) =>
        event.trusted && event.text.includes('100.01') && !event.text.includes('02 销售部'),
    ),
  ).toBe(true);
  await expect(page.locator('iframe[aria-label="系统打印"]')).toHaveCount(0);
  const pdfPage = await context.newPage();
  try {
    await pdfPage.setContent(html);
    await pdfPage.emulateMedia({ media: 'print' });
    await pdfPage.evaluate(() => document.fonts.ready);
    const pdf = await pdfPage.pdf({
      preferCSSPageSize: true,
      path: info.outputPath('部门期初.pdf'),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = [...pdf.toString('latin1').matchAll(/\b\d+\s+\d+\s+obj\b[\s\S]*?endobj/g)]
      .map((match) => match[0])
      .filter((object) => /\/Type\s*\/Page\b/.test(object));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatch(/\/Contents\s+(?:\d+\s+\d+\s+R|\[)/);
    await pdfPage.screenshot({ path: info.outputPath('部门期初.png'), fullPage: true });
  } finally {
    await pdfPage.close();
  }
  await modal.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page
    .locator('.cw-data-table:visible')
    .nth(1)
    .getByRole('button', { name: '修改', exact: true })
    .click();
  const drawer = page.getByRole('dialog', { name: '修改期初', exact: true });
  await drawer.getByLabel('年初余额（本位币）', { exact: true }).fill('999.99');
  await expect(
    page.getByRole('button', { name: '打印预览', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await page.keyboard.press('Control+p');
  await expect(modal).not.toBeVisible();
  await expect(drawer.getByLabel('年初余额（本位币）', { exact: true })).toHaveValue('999.99');
});
