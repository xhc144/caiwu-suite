import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { DEFAULT_SETTINGS } from '../shared';

test('w_hf：备份后改数据，页面预览、保护备份、覆盖并重新登录，原数据真实回退', async ({
  page,
  request,
}) => {
  const original = await loginWithNewBook(page, request);
  const api = <T>(procedure: string, input?: unknown, method?: 'GET' | 'POST') =>
    callApi<T>(request, procedure, input, { token: original.token, method });
  // 用本模块持久设置作合成数据：确认实际恢复了SQLite内容，避免依赖其他业务页面。
  await api('m.backup.saveSettings', { ...DEFAULT_SETTINGS, intervalMinutes: 17 });
  const item = await api<{ id: string }>('m.backup.create', {
    requestId: randomUUID(),
    name: '覆盖回退源',
  });
  await expect
    .poll(
      async () =>
        (await api<{ id: string; status: string }[]>('m.backup.list', undefined, 'GET')).find(
          (r) => r.id === item.id,
        )?.status,
    )
    .toBe('valid');
  await api('m.backup.saveSettings', { ...DEFAULT_SETTINGS, intervalMinutes: 121 });
  await page.goto('/m/backup/');
  await page.getByRole('radio', { name: '覆盖当前账套（先生成保护备份）', exact: true }).check();
  await page
    .getByRole('row')
    .filter({ has: page.getByText('覆盖回退源', { exact: true }) })
    .getByRole('button', { name: '恢复预览' })
    .click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByText('启用 / 当前期间', { exact: true }) })
      .getByText('202601 / 202601', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(original.bookId, { exact: true })).toBeVisible();
  const confirm = page.getByRole('button', { name: '确认覆盖当前账套', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByRole('button', { name: '先生成恢复前保护备份', exact: true }).click();
  await expect(page.getByText(/保护备份：backups\//)).toBeVisible();
  await page.getByLabel('恢复确认文字', { exact: true }).fill(`覆盖 ${original.bookName}`);
  await page.getByLabel('管理员密码', { exact: true }).fill('admin');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('heading', { name: '已覆盖恢复账套', exact: true })).toBeVisible();
  await expect(api('m.backup.list', undefined, 'GET')).rejects.toThrow('登录已失效');
  await page.addInitScript(() => sessionStorage.removeItem('caiwu.session'));
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await page.goto(`/login/${original.bookId}`);
  await page.getByLabel('密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole('menuitem', { name: '备份恢复', exact: true }).click();
  await expect(page.getByLabel('定时间隔 / 分钟', { exact: true })).toHaveValue('17');
  const protection = page
    .getByRole('row')
    .filter({ has: page.getByText('恢复前保护备份', { exact: true }) });
  await expect(protection).toContainText('校验通过');
  await protection.getByRole('button', { name: '校验', exact: true }).click();
  await expect(
    page.getByText('SQLite 完整性、长度、摘要和迁移版本校验通过', { exact: true }),
  ).toBeVisible();
});
