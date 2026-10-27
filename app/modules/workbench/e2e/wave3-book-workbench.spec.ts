import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createTestBook } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import type { Voucher } from '@caiwu/core';
import type { SessionState } from '@caiwu/web-kit';

test('w_pz_pzedit → w_pz_pzxsb → w_main1：键盘留空行、F5保存、另一操作员审核、已打开工作台刷新待过账1', async ({
  page,
  playwright,
}) => {
  const book = await createTestBook();
  const permissions = [
    'voucher-entry.view',
    'voucher-entry.edit',
    'voucher-book.view',
    'voucher-book.audit',
    'workbench.overview.view',
    'workbench.search',
  ];
  await book.addUser('maker', { name: '制单员', password: 'maker', permissions });
  await book.addUser('auditor', { name: '审核员', password: 'auditor', permissions });
  await book.store.closeAll();
  const local = spawnLocalServer({
    dataDir: book.dataDir,
    shutdownProtocol: 'native',
    env: {
      CAIWU_PORT: '0',
      CAIWU_TOKEN: 'e2e-token',
      CAIWU_DEV: '1',
      CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
    },
  });
  const port = await local.ready();
  const address = `http://127.0.0.1:${port}`;
  const http = await playwright.request.newContext({ baseURL: address });
  try {
    const login = await callApi<Omit<SessionState, 'bookId'>>(http, 'core.auth.login', {
      bookId: book.info.id,
      userCode: 'maker',
      password: 'maker',
    });
    await page.goto(address);
    await page.evaluate(
      (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
      { ...login, bookId: book.info.id },
    );
    await page.goto(`${address}/home`);
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: '凭证录入', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).focus();
    await page.keyboard.type('费用');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: '第1行科目', exact: true })).toBeFocused();
    await page.keyboard.type('6603');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('第1行借方', { exact: true })).toBeFocused();
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    for (let move = 0; move < 20; move++) {
      if (
        await page
          .getByLabel('第3行摘要', { exact: true })
          .evaluate((input) => input === document.activeElement)
      )
        break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByLabel('第3行摘要', { exact: true })).toBeFocused();
    await page.keyboard.type('收入');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: '第3行科目', exact: true })).toBeFocused();
    await page.keyboard.type('6001');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('第3行借方', { exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('第3行贷方', { exact: true })).toBeFocused();
    await page.keyboard.type('1000');
    await page.keyboard.press('F5');
    await expect(page.getByRole('status')).toContainText('已保存 记-0001');
    const saved = await callApi<{ items: Voucher[] }>(
      http,
      'core.vouchers.list',
      {},
      { token: login.token, method: 'GET' },
    );
    const voucher = await callApi<Voucher>(
      http,
      'core.vouchers.get',
      { id: saved.items[0]!.id },
      { token: login.token, method: 'GET' },
    );
    expect(voucher.lines.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['6603', 100000, 0],
      ['6001', 0, 100000],
    ]);
    await page.getByRole('menuitem', { name: '凭证序时簿', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '记-0001' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '审核 F4', exact: true }).click();
    const ownPreview = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(ownPreview).toContainText('制单人与审核人相同');
    await expect(ownPreview.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
    await ownPreview.getByRole('button', { name: '取消', exact: true }).click();
    // main 的壳在没有未保存内容时直接退出；不再等待旧的无条件确认框。
    await page.getByRole('button', { name: /制单员$/ }).hover();
    await page.getByRole('menuitem', { name: '切换用户 / 退出登录', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '搜索账套', exact: true })).toBeVisible();
    await page
      .getByRole('row')
      .filter({ hasText: book.info.id })
      .getByRole('button', { name: '进入', exact: true })
      .click();
    await expect(page.getByLabel('用户编号', { exact: true })).toBeVisible();
    await page.getByLabel('用户编号', { exact: true }).fill('auditor');
    await page.getByLabel('密码', { exact: true }).fill('auditor');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
    const pending = page
      .locator('.ant-card')
      .filter({ has: page.getByRole('button', { name: '处理待审核凭证', exact: true }) });
    const audited = page
      .locator('.ant-card')
      .filter({ has: page.getByRole('button', { name: '处理待过账凭证', exact: true }) });
    await expect(pending.locator('.ant-statistic-content-value')).toHaveText('1');
    await expect(audited.locator('.ant-statistic-content-value')).toHaveText('0');
    await page.getByRole('button', { name: '处理待审核凭证', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '记-0001' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '审核 F4', exact: true }).click();
    const preview = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(preview).toContainText('可处理 1 张，跳过 0 张');
    await preview.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByText('成功 1 张，跳过 0 张', { exact: true })).toBeVisible();
    const refreshed = page.waitForResponse(
      (response) => response.url().includes('m.workbench.overview') && response.ok(),
    );
    await page.getByRole('tab', { name: '首页', exact: true }).click();
    await refreshed;
    await expect(pending.locator('.ant-statistic-content-value')).toHaveText('0');
    await expect(audited.locator('.ant-statistic-content-value')).toHaveText('1');
    await page.getByRole('button', { name: '处理待过账凭证', exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'audited');
    await expect(page.getByRole('row').filter({ hasText: '记-0001' })).toContainText('已审核');
  } finally {
    await http.dispose();
    await local.close();
    await book.close();
  }
});
