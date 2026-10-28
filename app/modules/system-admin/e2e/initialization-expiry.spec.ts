import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { callApi } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test.use({ controlledClock: true });

for (const action of ['取消初始化预览', '保存参数', '离开放弃'] as const) {
  test(`w_xt_kgzb 预览过期且预检已清理后${action}可完成，过期执行仍拒绝`, async ({
    page,
    isolated,
  }) => {
    await page.goto(`${isolated.baseURL}/m/system-admin/reset`);
    await page.getByLabel('初始化后的账套名称', { exact: true }).fill('过期预览仅保存参数');
    await page.getByLabel('当前管理员密码', { exact: true }).fill('admin');
    const prepared = page.waitForResponse((res) =>
      res.url().includes('m.system-admin.reset.prepare'),
    );
    await page.getByRole('button', { name: '预览初始化内容', exact: true }).click();
    const body: unknown = await (await prepared).json();
    const plan = (Array.isArray(body) ? body[0] : body) as { result: { data: { planId: string } } };
    await expect(
      page.getByRole('button', { name: '执行完整重新初始化', exact: true }),
    ).toBeVisible();
    isolated.advanceClock!(300_001);
    await callApi(isolated.request, 'm.system-admin.reset.preflight', undefined, {
      token: isolated.token,
      method: 'GET',
    });
    await expect(
      callApi(
        isolated.request,
        'm.system-admin.reset.execute',
        {
          planId: plan.result.data.planId,
          confirmBookName: '测试账套',
          password: 'admin',
          confirmed: true,
          confirmation: '重新初始化',
        },
        { token: isolated.token },
      ),
    ).rejects.toThrow('预览已过期');
    if (action === '离开放弃') {
      await page.keyboard.press('Control+F4');
      await page
        .getByRole('dialog', { name: '有未保存内容', exact: true })
        .getByRole('button', { name: '放弃修改并继续', exact: true })
        .click();
      await expect(page).toHaveURL(`${isolated.baseURL}/home`);
    } else {
      await page.getByRole('button', { name: action, exact: true }).click();
      await expect(page.getByRole('button', { name: '取消初始化预览', exact: true })).toBeHidden();
      await expect(
        page.getByRole('button', { name: '执行完整重新初始化', exact: true }),
      ).toBeHidden();
      if (action === '保存参数') {
        const saved = await callApi<{ draft: { name: string } }>(
          isolated.request,
          'm.system-admin.reset.preflight',
          undefined,
          { token: isolated.token, method: 'GET' },
        );
        expect(saved.draft.name).toBe('过期预览仅保存参数');
      }
    }
    expect(
      readdirSync(path.join(isolated.dataDir, 'restore-staging')).filter((file) =>
        file.endsWith('.sqlite'),
      ),
    ).toHaveLength(0);
    expect(
      (
        await callApi<{ book: { id: string } }>(isolated.request, 'core.auth.me', undefined, {
          token: isolated.token,
          method: 'GET',
        })
      ).book.id,
    ).toBe(isolated.bookId);
  });
}

test('w_xt_kgzb 真实取消清理故障禁用执行并保留重试；过期再清理后仍可安全取消离开', async ({
  page,
  isolated,
}) => {
  await page.goto(`${isolated.baseURL}/m/system-admin/reset`);
  await page.getByLabel('当前管理员密码', { exact: true }).fill('admin');
  const prepared = page.waitForResponse((res) =>
    res.url().includes('m.system-admin.reset.prepare'),
  );
  await page.getByRole('button', { name: '预览初始化内容', exact: true }).click();
  const body: unknown = await (await prepared).json();
  const plan = (Array.isArray(body) ? body[0] : body) as { result: { data: { planId: string } } };
  await expect(page.getByRole('button', { name: '执行完整重新初始化', exact: true })).toBeVisible();
  const directory = path.join(isolated.dataDir, 'restore-staging');
  const held = directory + '-held';
  renameSync(directory, held);
  mkdirSync(directory);
  try {
    await page.getByRole('button', { name: '取消初始化预览', exact: true }).click();
    await expect(
      page.getByText('初始化暂存未能清理，请重试取消；原账套及保护副本保留', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '执行完整重新初始化', exact: true }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: '取消初始化预览', exact: true })).toBeVisible();
    expect(readdirSync(held).filter((file) => file.endsWith('.sqlite'))).toHaveLength(1);
    await expect(
      callApi(
        isolated.request,
        'm.system-admin.reset.execute',
        {
          planId: plan.result.data.planId,
          confirmBookName: '测试账套',
          password: 'admin',
          confirmed: true,
          confirmation: '重新初始化',
        },
        { token: isolated.token },
      ),
    ).rejects.toThrow('预览已过期');
    expect(
      (
        await callApi<{ book: { id: string } }>(isolated.request, 'core.auth.me', undefined, {
          token: isolated.token,
          method: 'GET',
        })
      ).book.id,
    ).toBe(isolated.bookId);
    isolated.advanceClock!(300_001);
    await callApi(isolated.request, 'm.system-admin.reset.preflight', undefined, {
      token: isolated.token,
      method: 'GET',
    });
  } finally {
    rmSync(directory, { recursive: true });
    renameSync(held, directory);
  }
  await page.getByRole('button', { name: '取消初始化预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消初始化预览', exact: true })).toBeHidden();
  await expect(
    page.getByText('初始化暂存未能清理，请重试取消；原账套及保护副本保留', { exact: true }),
  ).toBeHidden();
  expect(readdirSync(directory).filter((file) => file.endsWith('.sqlite'))).toHaveLength(0);
});
