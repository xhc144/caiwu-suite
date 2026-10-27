import { seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { seedPostedMonths } from '../test/posted-months';
import { test, expect } from './fixture';
import type { Locator, Page } from '@playwright/test';

// CI trace 显示 Modal 的 prepare→active 短暂稳定期只有20%尺寸，物理点击未发出POST。
// 等真实入场结束再普通点击；响应使用5秒预算，整条测试继续零重试。
async function confirmContinuousClose(page: Page, preview: Locator, message: string) {
  await expect(preview).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate(
        (element) =>
          getComputedStyle(element).transform === 'none' &&
          !/ant-zoom-(appear|enter)/.test(element.getAttribute('class') ?? '') &&
          !element
            .getAnimations({ subtree: true })
            .some((animation) => animation.playState === 'running'),
      ),
    )
    .toBe(true);
  const confirm = preview.getByRole('button', { name: '确认连续结账', exact: true });
  await expect(confirm).toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/trpc/m.period-close.closeRange',
      { timeout: 5_000 },
    ),
    confirm.click(),
  ]);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject([{ result: { data: { message } } }]);
}

// 本模块在 CI 和本地都只执行一次，失败必须保留。
test.describe.configure({ retries: 0 });

test('w_zw_fz：连续结账真实预览、取消、关闭三个月及原地反结；结转全选只选启用类型', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const api = app.call(periodCloseServer);
  for (const [index, code] of ['A', 'B', 'OFF'].entries())
    await api.saveRule({
      data: {
        code,
        name: code,
        kind: 'custom',
        order: index + 1,
        enabled: code !== 'OFF',
        voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
        summary: '合成结转',
        targetAccountId: (await app.svc.accounts.require('4103')).id,
        sources: [
          { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '100' },
        ],
      },
    });
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601&from=202601&to=202603`);
  await expect(page.getByRole('checkbox', { name: '选择 A', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: '选择 A', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: '选择 B', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '全选启用结转类型', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '选择 A', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择 B', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择 OFF', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择 OFF', exact: true })).toBeDisabled();
  const before = {
    periods: await app.svc.periods.list(),
    opening: await app.svc.opening.list(2026),
    vouchers: await app.svc.vouchers.list(),
    logs: await app.svc.log.list(),
    balances: await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 }),
  };
  await page.getByRole('button', { name: '连续结账预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '本年连续结账预览', exact: true });
  for (const month of ['01', '02', '03']) await expect(preview).toContainText(`2026年${month}月`);
  await expect(preview.getByRole('button', { name: '确认连续结账', exact: true })).toBeEnabled();
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).not.toBeVisible();
  expect({
    periods: await app.svc.periods.list(),
    opening: await app.svc.opening.list(2026),
    vouchers: await app.svc.vouchers.list(),
    logs: await app.svc.log.list(),
    balances: await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 }),
  }).toEqual(before);
  await page.getByRole('button', { name: '连续结账预览', exact: true }).click();
  await confirmContinuousClose(page, preview, '已连续结账 202601—202603 共 3 个月');
  await expect(preview).not.toBeVisible();
  await expect(page.getByText('已连续结账 202601—202603 共 3 个月', { exact: true })).toBeVisible();
  expect(
    (await app.svc.periods.list()).filter((p) => p.status === 'closed').map((p) => p.period),
  ).toEqual([202601, 202602, 202603]);
  expect(await app.svc.vouchers.list()).toEqual(before.vouchers);
  await page.getByRole('button', { name: '反结账', exact: true }).click();
  const confirmation = page.locator('.ant-popover').filter({
    has: page.getByText('从 202603 向前反结账至 202601？', { exact: true }),
  });
  await expect(confirmation).toBeVisible();
  // 入场缩放会在坐标采样与指针派发之间移动按钮；等待真实动画结束再确认。
  await expect
    .poll(() =>
      confirmation.evaluate(
        (element) =>
          getComputedStyle(element).transform === 'none' &&
          !/ant-zoom-big-(appear|enter)/.test(element.getAttribute('class') ?? ''),
      ),
    )
    .toBe(true);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/trpc/m.period-close.reopen',
      { timeout: 5_000 },
    ),
    confirmation.getByRole('button', { name: '确定', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject([
    { result: { data: { message: '已反结账 3 个月，余额及当年期初保持不变' } } },
  ]);
  await expect(
    page.getByText('已反结账 3 个月，余额及当年期初保持不变', { exact: true }),
  ).toBeVisible();
  expect((await app.svc.periods.list()).every((p) => p.status === 'open')).toBe(true);
  expect(await app.svc.opening.list(2026)).toEqual(before.opening);
  expect(await app.svc.vouchers.list()).toEqual(before.vouchers);
  expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202603 })).toEqual(
    before.balances,
  );
  expect(await app.svc.log.list()).toContainEqual(
    expect.objectContaining({ action: 'period-close.reopen' }),
  );
});

test('w_zw_fz：后月未过账时逐月定位并禁用连续确认，不提前关闭前月', async ({ page, local }) => {
  const { app, url } = local;
  await seedVouchers(app.svc, [
    {
      date: '2026-02-05',
      lines: [
        { account: '4001', debit: 100 },
        { account: '4103', credit: 100 },
      ],
    },
  ]);
  const before = await app.svc.vouchers.list();
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601&from=202601&to=202603`);
  await page.getByRole('button', { name: '连续结账预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '本年连续结账预览', exact: true });
  await expect(preview).toContainText('2026年02月');
  await expect(preview).toContainText('待审核 / 未过账');
  await expect(preview).toContainText('记-0001');
  await expect(preview.getByRole('button', { name: '确认连续结账', exact: true })).toBeDisabled();
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  expect((await app.svc.periods.list()).every((p) => p.status === 'open')).toBe(true);
  expect(await app.svc.vouchers.list()).toEqual(before);
  await page.getByRole('button', { name: '连续结账预览', exact: true }).click();
  await preview.getByRole('button', { name: '处理 2026年02月', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(page).toHaveURL(/period=202602/);
  await expect(page.getByRole('heading', { name: /2026年02月 · 开放/ })).toBeVisible();
  expect((await app.svc.periods.list()).every((p) => p.status === 'open')).toBe(true);
});

test('w_zw_fz P1：两月结转已异人审核过账，浏览器连续结账保留全部来源凭证和期初', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const seeded = await seedPostedMonths(app);
  const api = app.call(periodCloseServer);
  for (const period of [202601, 202602])
    expect(
      (await api.check({ period })).items.filter((i) => i.id !== 'sequence').every((i) => i.pass),
    ).toBe(true);
  const vouchers = await Promise.all(
    (await app.svc.vouchers.list()).items.map((v) => app.svc.vouchers.get(v.id)),
  );
  const opening = await app.svc.opening.list(2026);
  expect(
    vouchers
      .filter((v) => seeded.generated.includes(v!.id))
      .every(
        (v) =>
          v!.status === 'posted' &&
          v!.auditedBy?.id === seeded.reviewerId &&
          v!.createdBy.id !== seeded.reviewerId,
      ),
  ).toBe(true);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601&from=202601&to=202602`);
  await page.getByRole('button', { name: '连续结账预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '本年连续结账预览', exact: true });
  await expect(preview).toContainText('2026年01月');
  await expect(preview).toContainText('2026年02月');
  await expect(preview.getByRole('button', { name: '确认连续结账', exact: true })).toBeEnabled();
  await confirmContinuousClose(page, preview, '已连续结账 202601—202602 共 2 个月');
  await expect(preview).not.toBeVisible();
  await expect(page.getByText('已连续结账 202601—202602 共 2 个月', { exact: true })).toBeVisible();
  expect(
    (await app.svc.periods.list()).filter((p) => p.status === 'closed').map((p) => p.period),
  ).toEqual([202601, 202602]);
  expect(
    await Promise.all((await app.svc.vouchers.list()).items.map((v) => app.svc.vouchers.get(v.id))),
  ).toEqual(vouchers);
  expect(await app.svc.opening.list(2026)).toEqual(opening);
  const links = (await api.check({ period: 202601 })).generated.concat(
    (await api.check({ period: 202602 })).generated,
  );
  expect(links.map((g) => g.voucherId)).toEqual(seeded.generated);
});
