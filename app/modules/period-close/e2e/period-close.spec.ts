import type { Page } from '@playwright/test';
import { seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { test, expect } from './fixture';

// 本模块在 CI 和本地都只执行一次，失败必须保留。
test.describe.configure({ retries: 0 });

async function confirmPeriodAction(page: Page, title: string, action: 'close' | 'reopen') {
  const confirmation = page.locator('.ant-popover').filter({
    has: page.getByText(title, { exact: true }),
  });
  await expect(confirmation).toBeVisible();
  // 入场缩放会移动确认按钮；等待真实动画完成，不修改动画或绕过命中检查。
  await expect
    .poll(() =>
      confirmation.evaluate(
        (element) =>
          getComputedStyle(element).transform === 'none' &&
          !/ant-zoom-big-(appear|enter)/.test(element.getAttribute('class') ?? '') &&
          !element.getAnimations({ subtree: true }).some((entry) => entry.playState === 'running'),
      ),
    )
    .toBe(true);
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/trpc/m.period-close.${action}`,
      { timeout: 5_000 },
    ),
    confirmation.getByRole('button', { name: '确定', exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject([
    { result: { data: { message: expect.any(String) } } },
  ]);
  // 旧层完全退场后才能打开下一次确认；定位始终属于当前动作。
  await expect(confirmation).toBeHidden();
}

test('独立账套真实主流程：过账 → 浏览器结转预览生成 → 夹具用户B审核 → 过账 → 结账 → 反结账', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const { reviewer } = await local.seedAudited();
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601&from=202601&to=202601`);
  await expect(page.getByRole('heading', { name: '过账与结账' })).toBeVisible();
  await page.getByRole('button', { name: '新增结转类型', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增结转类型' });
  const voucherType = drawer.getByLabel('凭证类型', { exact: true });
  await voucherType.click();
  await voucherType.press('ArrowDown');
  await voucherType.press('Enter');
  await expect(drawer.getByTitle('记 记账凭证', { exact: true })).toBeVisible();
  await drawer.getByLabel('唯一转入末级科目').fill('4103');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '过账', exact: true }).click();
  await expect(page.getByText('已过账 2 张凭证', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '月度结转预览' });
  await expect(preview).toContainText('借方 1,000.00 / 贷方 1,000.00');
  await expect(preview).toContainText('管理费用');
  const before = (await app.svc.vouchers.list()).total;
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).not.toBeVisible();
  expect((await app.svc.vouchers.list()).total).toBe(before);
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '确认生成待审核凭证' }).click();
  await expect(preview).not.toBeVisible();
  await expect(
    page.getByText('请其他操作员审核结转凭证后，再过账并结账', { exact: true }),
  ).toBeVisible();
  const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(generated).toHaveLength(1);
  expect(generated[0]!.status).toBe('pending');
  expect(generated[0]!.createdBy.id).not.toBe(reviewer.user.id);
  await reviewer.vouchers.changeStatus({ ids: generated.map((v) => v.id), to: 'audited' });
  await page.getByRole('button', { name: '过账', exact: true }).click();
  await expect(page.getByText('已过账 1 张凭证', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /检查全部通过/ })).toBeVisible();
  const opening = await app.svc.opening.list(2026);
  const balances = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
  await page.getByRole('button', { name: '结账', exact: true }).click();
  await confirmPeriodAction(page, '确认结账 2026年01月？', 'close');
  await expect(page.getByRole('heading', { name: /2026年01月 · 已结账/ })).toBeVisible();
  await page.getByRole('button', { name: '反结账', exact: true }).click();
  await confirmPeriodAction(page, '从 202601 向前反结账至 202601？', 'reopen');
  await expect(
    page.getByText('已反结账 1 个月，余额及当年期初保持不变', { exact: true }),
  ).toBeVisible();
  expect((await app.svc.periods.require(202601)).status).toBe('open');
  expect(await app.svc.opening.list(2026)).toEqual(opening);
  expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).toEqual(balances);
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
});

test('独立账套未过账/断号拦截及取消确认不写库；处理链接指向真实凭证路由', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  await local.seedAudited();
  const api = app.call(periodCloseServer);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  const unposted = page
    .getByRole('row')
    .filter({ has: page.getByText('待审核 / 未过账', { exact: true }) });
  await expect(unposted).toContainText('不通过');
  await expect(unposted).toContainText('记-0001');
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  // 未选择结转内容也有独立阻止；这里先配置规则以检查正式凭证前置。
  await api.saveRule({
    data: {
      code: 'PNL',
      name: '损益',
      kind: 'pnl',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '损益结转',
      order: 1,
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('4103')).id,
      sources: [],
    },
  });
  await page.getByRole('button', { name: '重新检查' }).click();
  await expect(page.getByRole('checkbox', { name: '选择 PNL' })).toBeVisible();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  await expect(page.getByText(/本月还有 2 张有效正式凭证未过账/)).toBeVisible();
  const cancelledState = async () => ({
    vouchers: await Promise.all(
      (await app.svc.vouchers.list()).items.map((v) => app.svc.vouchers.get(v.id)),
    ),
    opening: await app.svc.opening.list(2026),
    balances: await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 }),
    periods: await app.svc.periods.list(),
    logs: await app.svc.log.list(),
  });
  const beforeCancel = await cancelledState();
  await page.getByRole('button', { name: '反过账', exact: true }).click();
  const unpostConfirmation = page.locator('.ant-popover').filter({
    has: page.getByText('确认反过账 202601—202601？', { exact: true }),
  });
  await expect(unpostConfirmation).toBeVisible();
  await unpostConfirmation.getByRole('button', { name: '取消', exact: true }).click();
  // 等待旧确认层退场，后续取消只能属于本次结账确认。
  await expect(unpostConfirmation).toBeHidden();
  expect((await app.svc.vouchers.list()).items.every((v) => v.status === 'audited')).toBe(true);
  expect(await cancelledState()).toEqual(beforeCancel);
  await page.getByRole('button', { name: '结账', exact: true }).click();
  const closeConfirmation = page.locator('.ant-popover').filter({
    has: page.getByText('确认结账 2026年01月？', { exact: true }),
  });
  await expect(closeConfirmation).toBeVisible();
  await closeConfirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(closeConfirmation).toBeHidden();
  expect((await app.svc.periods.require(202601)).status).toBe('open');
  expect(await cancelledState()).toEqual(beforeCancel);
  await page.getByRole('button', { name: '过账', exact: true }).click();
  await expect(page.getByText('已过账 2 张凭证', { exact: true })).toBeVisible();
  const [extra] = await seedVouchers(app.svc, [
    {
      date: '2026-01-08',
      lines: [
        { account: '1001', debit: 1 },
        { account: '4001', credit: 1 },
      ],
    },
  ]);
  {
    const numberPlan = await app.svc.vouchers.previewNumbers([{ id: extra!.id, number: 5 }]);
    await app.svc.vouchers.setNumbers(numberPlan.updates, { plan: numberPlan, confirmed: true });
  }
  await app.svc.vouchers.setVoided(extra!.id, true);
  await page.getByRole('button', { name: '重新检查' }).click();
  const gaps = page.getByRole('row').filter({ has: page.getByText('凭证断号', { exact: true }) });
  await expect(gaps).toContainText('缺 3—4 号');
  await page.getByRole('checkbox', { name: /明确确认损益未结转/ }).check();
  await page.getByRole('button', { name: '结账', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText(/凭证断号：记 缺 3—4 号/)).toBeVisible();
  expect((await app.svc.periods.require(202601)).status).toBe('open');
  await page.getByRole('button', { name: '编号整理预览' }).click();
  const numberModal = page.getByRole('dialog', { name: '编号整理预览（第一次确认）' });
  await expect(numberModal).toContainText('5 → 3');
  await numberModal.getByRole('button', { name: '取消', exact: true }).click();
  expect((await app.svc.vouchers.get(extra!.id))!.number).toBe(5);
  await page.getByRole('button', { name: '编号整理预览' }).click();
  await numberModal.getByRole('button', { name: '继续确认影响' }).click();
  const second = page.getByRole('dialog', { name: '编号整理（第二次确认）' });
  await expect(second.getByRole('button', { name: '确定', exact: true })).toBeDisabled();
  await second.getByLabel('确认文字').fill('影响已打印凭证和账册，编号不可直接恢复');
  await second.getByRole('button', { name: '确定', exact: true }).click();
  await expect(second).not.toBeVisible();
  await expect(numberModal).not.toBeVisible();
  expect((await app.svc.vouchers.get(extra!.id))!.number).toBe(3);

  await unposted.getByRole('button', { name: '去处理' }).click();
  await expect(page).toHaveURL(/\/m\/voucher-book\?period=202601&status=pending$/);
});

test('独立账套逆年结：影响预览 → 在线备份 → 取消不改账 → 再次输入文字确认 → 逐月反结账', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const api = app.call(periodCloseServer);
  for (let month = 1; month <= 12; month++)
    await api.close({ period: 202600 + month, confirmed: true });
  await api.yearEnd({ year: 2026, confirmed: true });
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202612&from=202612&to=202612`);
  await expect(page.getByRole('heading', { name: /2026年12月 · 已结账/ })).toBeVisible();
  const original = JSON.stringify({
    opening: await app.svc.opening.list(2026),
    next: await app.svc.opening.list(2027),
    periods: await app.svc.periods.list(),
    years: await app.svc.periods.years(),
  });
  await page.getByRole('button', { name: '逆年结预览 / 在线备份' }).click();
  const plan = page.getByRole('dialog', { name: '逆年结影响预览' });
  await expect(plan).toContainText('2027 年本模块生成的 1 行期初和 12 个月份');
  await plan.getByRole('button', { name: '先执行在线备份' }).click();
  const confirmation = page.getByRole('dialog', { name: '在线备份成功：再次确认逆年结' });
  await expect(confirmation).toContainText('SQLite 在线备份已成功并校验');
  await expect(confirmation.getByRole('button', { name: '确认撤销年结' })).toBeDisabled();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    JSON.stringify({
      opening: await app.svc.opening.list(2026),
      next: await app.svc.opening.list(2027),
      periods: await app.svc.periods.list(),
      years: await app.svc.periods.years(),
    }),
  ).toBe(original);
  await page.getByRole('button', { name: '逆年结预览 / 在线备份' }).click();
  await plan.getByRole('button', { name: '先执行在线备份' }).click();
  await confirmation.getByLabel('逆年结确认文字').fill('撤销2026年年结');
  await confirmation.getByRole('button', { name: '确认撤销年结' }).click();
  await expect(confirmation).not.toBeVisible();
  expect(await app.svc.opening.list(2027)).toEqual([]);
  expect((await app.svc.periods.years()).map((y) => y.year)).toEqual([2026]);
  await page.getByRole('button', { name: '反结账', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByRole('heading', { name: /2026年12月 · 开放/ })).toBeVisible();
  expect(await app.svc.opening.list(2026)).toHaveLength(1);
  expect((await app.svc.periods.require(202612)).status).toBe('open');
});

test('独立现金流标志：自定义现金转出/银行转入可分别录项目与方向，生成行不丢项目', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const incoming = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CT_IN',
    name: '测试调拨流入',
    attrs: { cashflowDirection: 'inflow' },
  });
  const outgoing = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CT_OUT',
    name: '测试调拨流出',
    attrs: { cashflowDirection: 'outflow' },
  });
  const historical = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CT_OLD',
    name: '历史未设方向',
    attrs: { direction: 'in' },
  });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10000, dims: { cashflow: 'CF01' } },
        { account: '4001', credit: 10000 },
      ],
    },
  ]);
  const cash = await app.svc.accounts.require('1001');
  const bank = await app.svc.accounts.require('100201');
  expect(cash.dimensions).toEqual([]);
  expect(bank.dimensions).toEqual([]);
  expect(cash.cashflowRequired && bank.cashflowRequired).toBe(true);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  await page.getByRole('button', { name: '新增结转类型', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增结转类型' });
  await drawer.getByLabel('代码', { exact: true }).fill('CASH_MOVE');
  await drawer.getByLabel('结转内容', { exact: true }).click();
  await page.getByText('自定义科目余额比例', { exact: true }).last().click();
  const voucherType = drawer.getByLabel('凭证类型', { exact: true });
  await voucherType.click();
  await voucherType.press('ArrowDown');
  await voucherType.press('Enter');
  await expect(drawer.getByTitle('记 记账凭证', { exact: true })).toBeVisible();
  await drawer.getByLabel('唯一转入末级科目').fill('100201');
  await page.keyboard.press('Enter');
  await expect(drawer.getByLabel('转入流入现金流量项目', { exact: true })).toBeVisible();
  await drawer.getByLabel('转入流入现金流量项目', { exact: true }).fill('CT_OUT');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '增加转出科目' }).click();
  await drawer.getByLabel('转出科目', { exact: true }).fill('1001');
  await page.keyboard.press('Enter');
  await expect(drawer.getByLabel('转出流出现金流量项目', { exact: true })).toBeVisible();
  await drawer.getByLabel('转出流出现金流量项目', { exact: true }).fill('CT_OUT');
  await page.keyboard.press('Enter');
  await expect(drawer.getByTitle('记 记账凭证', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(
    page.getByText('现金流量项目 CT_OUT 已声明流出，不能用于流入', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('alert')
    .filter({ hasText: '现金流量项目 CT_OUT 已声明流出，不能用于流入' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  expect(await app.call(periodCloseServer).rules()).toEqual([]);
  await drawer.getByLabel('转入流入现金流量项目', { exact: true }).fill('CT_OLD');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(
    page.getByText('现金流量项目 CT_OLD 方向未配置或无法识别，不能生成结转凭证', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('alert')
    .filter({ hasText: '现金流量项目 CT_OLD 方向未配置或无法识别，不能生成结转凭证' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  expect((await app.svc.dimensions.get(historical.id))!.attrs).toEqual({ direction: 'in' });
  expect(await app.call(periodCloseServer).rules()).toEqual([]);
  await drawer.getByLabel('转入流入现金流量项目', { exact: true }).fill('CT_IN');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('转出流出现金流量项目', { exact: true }).fill('CT_IN');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(
    page.getByText('现金流量项目 CT_IN 已声明流入，不能用于流出', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('alert')
    .filter({ hasText: '现金流量项目 CT_IN 已声明流入，不能用于流出' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  expect(await app.call(periodCloseServer).rules()).toEqual([]);
  await drawer.getByLabel('转出流出现金流量项目', { exact: true }).fill('CT_OUT');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(drawer).not.toBeVisible();
  const definition = (await app.call(periodCloseServer).rules())[0]!;
  expect(definition.targetCashflows).toMatchObject({ in: incoming.id });
  expect(definition.sources[0]!.cashflows).toMatchObject({ out: outgoing.id });
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '月度结转预览' });
  await expect(preview).toContainText('借方 100.00 / 贷方 100.00');
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '确认生成待审核凭证' }).click();
  await expect(preview).not.toBeVisible();
  const headers = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(headers).toHaveLength(1);
  const generated = (await app.svc.vouchers.get(headers[0]!.id))!;
  expect(generated.status).toBe('pending');
  expect(generated.lines.find((l) => l.accountId === cash.id)).toMatchObject({
    debit: 0,
    credit: 10000,
    dimensions: { cashflow: outgoing.id },
  });
  expect(generated.lines.find((l) => l.accountId === bank.id)).toMatchObject({
    debit: 10000,
    credit: 0,
    dimensions: { cashflow: incoming.id },
  });
});

test('M03内部转移真实UI：单边内部流出阻止，现金转银行同张配平后生成待审核凭证', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const internal = await app.svc.dimensions.create({
    type: 'cashflow',
    code: 'CT_INTERNAL',
    name: '测试内部转移',
    attrs: { cashflowDirection: 'internal' },
  });
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 10000 },
        { account: '4001', credit: 10000 },
      ],
    },
  ]);
  const cash = await app.svc.accounts.require('1001');
  const bank = await app.svc.accounts.require('100201');
  await app.call(periodCloseServer).saveRule({
    data: {
      code: 'INTERNAL',
      name: '内部转移',
      kind: 'custom',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '测试内部现金转移',
      order: 1,
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('4103')).id,
      sources: [
        { accountId: cash.id, mode: 'balance', ratio: '100', cashflows: { out: internal.id } },
      ],
    },
  });
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  const original = await app.svc.vouchers.list();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  await expect(
    page.getByText('内部现金流入流出未配平，差额 -10000 分；每张结转凭证必须单独配平', {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('alert')
    .filter({ hasText: '内部现金流入流出未配平' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  expect(await app.svc.vouchers.list()).toEqual(original);
  await expect(page.getByRole('dialog', { name: '月度结转预览' })).not.toBeVisible();
  await page.getByRole('button', { name: '编辑 / 启停', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '编辑结转类型' });
  await drawer.getByLabel('唯一转入末级科目').fill('100201');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('转入流入现金流量项目', { exact: true }).fill('CT_INTERNAL');
  await page.keyboard.press('Enter');
  await expect(
    drawer.getByTitle('CT_INTERNAL 测试内部转移（内部转移）', { exact: true }).first(),
  ).toBeVisible();
  await drawer.getByRole('button', { name: '保存设置' }).click();
  await expect(drawer).not.toBeVisible();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '月度结转预览' });
  await expect(preview).toContainText('借方 100.00 / 贷方 100.00');
  await expect(preview).toContainText(`第1行项目 ${internal.id}（内部转移）`);
  await expect(preview).toContainText(`第2行项目 ${internal.id}（内部转移）`);
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '确认生成待审核凭证' }).click();
  await expect(preview).not.toBeVisible();
  const headers = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(headers).toHaveLength(1);
  const generated = (await app.svc.vouchers.get(headers[0]!.id))!;
  expect(generated.status).toBe('pending');
  expect(generated.lines).toHaveLength(2);
  expect(generated.lines.every((line) => line.dimensions.cashflow === internal.id)).toBe(true);
  expect(generated.lines.find((line) => line.accountId === cash.id)).toMatchObject({
    credit: 10000,
  });
  expect(generated.lines.find((line) => line.accountId === bank.id)).toMatchObject({
    debit: 10000,
  });
  expect(generated.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
});
