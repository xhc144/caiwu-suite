import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createTestBook } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import type { Voucher } from '@caiwu/core';

test('w_pz_pzedit → w_pz_pzxsb → w_main1：键盘三行留中空、F5正式保存、本人拒审、切换用户审核及待过账实时统计', async ({
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
  await book.addUser('maker-A', { name: '操作员A', password: 'example-A', permissions });
  await book.addUser('auditor-B', { name: '操作员B', password: 'example-B', permissions });
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
  const login = async (code: string, password: string) => {
    await expect
      .poll(
        async () =>
          (await page.getByLabel('用户编号', { exact: true }).isVisible()) ||
          (await page.getByRole('textbox', { name: '搜索账套', exact: true }).isVisible()),
      )
      .toBe(true);
    if (await page.getByRole('textbox', { name: '搜索账套', exact: true }).isVisible()) {
      await page
        .getByRole('row')
        .filter({ hasText: book.info.id })
        .getByRole('button', { name: '进入', exact: true })
        .click();
    }
    await page.getByLabel('用户编号', { exact: true }).fill(code);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  };
  const select = async (label: string, code: string) => {
    await expect(page.getByRole('combobox', { name: label, exact: true })).toBeFocused();
    await page.keyboard.type(code);
    await page.keyboard.press('Enter');
  };
  const switchUser = async (name: string) => {
    await page.getByRole('button', { name: new RegExp(name + '$') }).hover();
    await page.getByRole('menuitem', { name: '切换用户 / 退出登录', exact: true }).click();
    const loggedOut = page.waitForResponse(
      (response) => response.url().includes('core.auth.logout') && response.ok(),
    );
    await page
      .getByRole('dialog', { name: '切换用户 / 退出登录', exact: true })
      .getByRole('button', { name: '已保存内容，继续', exact: true })
      .click();
    await loggedOut;
  };
  try {
    await page.goto(`${address}/login/${book.info.id}`);
    await login('maker-A', 'example-A');
    await page.getByRole('menuitem', { name: '凭证录入', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).focus();
    await page.keyboard.type('费用');
    await page.keyboard.press('Enter');
    await select('第1行科目', '6603');
    await expect(page.getByLabel('第1行借方', { exact: true })).toBeFocused();
    await page.keyboard.type('1000');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // 第二行摘要
    // 用正常 Tab 顺序穿过第二行，不选择科目也不输入任何业务内容。
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
    await select('第3行科目', '6001');
    await expect(page.getByLabel('第3行借方', { exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('第3行贷方', { exact: true })).toBeFocused();
    await page.keyboard.type('1000');
    await page.keyboard.press('F5');
    await expect(page.getByRole('status')).toContainText('已保存 记-0001');
    const makerSession = await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('caiwu.session')!) as { token: string },
    );
    const list = await callApi<{ items: Voucher[] }>(
      http,
      'core.vouchers.list',
      {},
      { token: makerSession.token, method: 'GET' },
    );
    const saved = await callApi<Voucher>(
      http,
      'core.vouchers.get',
      { id: list.items[0]!.id },
      { token: makerSession.token, method: 'GET' },
    );
    expect(saved.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([
      ['6603', 100000, 0],
      ['6001', 0, 100000],
    ]);
    await page.getByRole('link', { name: '重新打开凭证', exact: true }).click();
    await expect(page.locator('table[aria-label="分录网格"] tbody [data-line]')).toHaveCount(2);
    await page.getByRole('menuitem', { name: '凭证序时簿', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '记-0001' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '审核 F4', exact: true }).click();
    let preview = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(preview).toContainText('制单人与审核人相同');
    await expect(preview.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
    await preview.getByRole('button', { name: '取消', exact: true }).click();
    await switchUser('操作员A');
    await login('auditor-B', 'example-B');
    // 先留下工作台缓存，审核后通过现有标签返回，验证激活刷新。
    await expect(page.getByText('待审核凭证', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '处理待审核凭证', exact: true }).click();
    await page.getByRole('row').filter({ hasText: '记-0001' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '审核 F4', exact: true }).click();
    preview = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(preview).toContainText('可处理 1 张，跳过 0 张');
    await preview.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByText('成功 1 张，跳过 0 张', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '首页', exact: true }).click();
    const pending = page
      .locator('.ant-card')
      .filter({ has: page.getByText('待审核凭证', { exact: true }) });
    const audited = page
      .locator('.ant-card')
      .filter({ has: page.getByText('待过账凭证', { exact: true }) });
    await expect(pending.locator('.ant-statistic-content-value')).toHaveText('0');
    await expect(audited.locator('.ant-statistic-content-value')).toHaveText('1');
    await page.getByRole('button', { name: '处理待过账凭证', exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('period') === '202601' && url.searchParams.get('status') === 'audited',
    );
    await expect(page.getByRole('row').filter({ hasText: '记-0001' })).toContainText('已审核');
  } finally {
    await http.dispose();
    await local.close();
    await book.close();
  }
});
