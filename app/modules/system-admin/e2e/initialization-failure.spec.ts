import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test('w_xt_kgzb_2 真实保护备份目录故障：HTTP 明确未完成，原账可重登且不丢已过账凭证', async ({
  page,
  isolated,
}) => {
  const { request, bookId, token, voucherId, dataDir } = isolated;
  const original = await callApi<{ book: { name: string } }>(request, 'core.auth.me', undefined, {
    token,
    method: 'GET',
  });
  const voucher = await callApi(
    request,
    'core.vouchers.get',
    { id: voucherId },
    { token, method: 'GET' },
  );
  await page.goto(`${isolated.baseURL}/m/system-admin/reset`);
  await page.getByLabel('初始化后的账套名称', { exact: true }).fill('合成备份故障不得覆盖');
  await page.getByLabel('当前管理员密码', { exact: true }).fill('admin');
  await page.getByRole('button', { name: '预览初始化内容', exact: true }).click();
  await expect(page.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeVisible();
  const parent = path.join(dataDir, 'core-protection');
  mkdirSync(parent, { recursive: true });
  const marker = path.join(parent, bookId);
  writeFileSync(marker, '本测试独占账套的合成备份目录故障', { flag: 'wx' });
  try {
    await page.getByLabel('输入当前账套完整名称确认', { exact: true }).fill(original.book.name);
    await page.getByRole('button', { name: '执行完整重新初始化', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '再次确认完整重新初始化', exact: true });
    await dialog.getByLabel('确认文字', { exact: true }).fill('重新初始化');
    const response = page.waitForResponse((res) =>
      res.url().includes('m.system-admin.reset.execute'),
    );
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    const body: unknown = await (await response).json();
    const failure = (Array.isArray(body) ? body[0] : body) as {
      error: { data: { business: { code: string; message: string; hint: string } } };
    };
    expect(failure.error.data.business).toMatchObject({
      code: 'RESET_FAILED',
      message: '完整初始化未完成，请核对账套恢复状态',
    });
    expect(failure.error.data.business.hint).toContain('不要反复执行初始化');
    await expect(
      page.getByText('完整初始化未完成，请核对账套恢复状态', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      callApi(request, 'core.auth.me', undefined, { token, method: 'GET' }),
    ).rejects.toThrow('登录已失效');
    const fresh = await callApi<{ token: string; book: { name: string } }>(
      request,
      'core.auth.login',
      { bookId, userCode: 'admin', password: 'admin' },
    );
    expect(fresh.book.name).toBe(original.book.name);
    expect(
      await callApi(
        request,
        'core.vouchers.get',
        { id: voucherId },
        { token: fresh.token, method: 'GET' },
      ),
    ).toEqual(voucher);
    expect(readFileSync(marker, 'utf8')).toBe('本测试独占账套的合成备份目录故障');
    expect(
      readdirSync(path.join(dataDir, 'restore-staging')).filter((file) => file.endsWith('.sqlite')),
    ).toHaveLength(0);
  } finally {
    rmSync(marker);
  }
});
