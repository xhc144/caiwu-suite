import { seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { test, expect } from './fixture';

test('w_xt_jzwh / w_zw_ydjz：从真实入口设置外币数量换算、重开、取消预览及生成待审核来源凭证', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const target = await app.svc.accounts.create(
    {
      code: '1701',
      name: '合成外币数量',
      categoryId: 'asset',
      currency: 'USD',
      quantityUnit: '件',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 71001 },
        { account: '4103', credit: 71001 },
      ],
    },
  ]);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  await page.getByRole('button', { name: '新增结转类型', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增结转类型' });
  await drawer.getByLabel('代码', { exact: true }).fill('FXQ');
  await drawer.getByLabel('说明', { exact: true }).fill('显式换算');
  await drawer.getByLabel('结转内容', { exact: true }).click();
  await page.getByText('自定义科目余额比例', { exact: true }).click();
  const type = drawer.getByLabel('凭证类型', { exact: true });
  await type.click();
  await type.press('ArrowDown');
  await type.press('Enter');
  await drawer.getByLabel('唯一转入末级科目').fill('1701');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('转入汇率（本币元/USD）', { exact: true }).fill('7.1');
  await drawer.getByLabel('转入本币单价（元/件）', { exact: true }).fill('2.55');
  await drawer.getByLabel('转入部门', { exact: true }).fill('01');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '增加转出科目', exact: true }).click();
  await drawer.getByLabel('转出科目', { exact: true }).fill('4001');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const api = app.call(periodCloseServer);
  expect((await api.rules())[0]!.targetConversion).toEqual({
    currency: 'USD',
    exchangeRate: '7.1',
    quantityUnit: '件',
    unitPrice: '2.55',
  });
  const row = page.getByRole('row').filter({ has: page.getByText('FXQ', { exact: true }) });
  await row.getByRole('button', { name: '编辑 / 启停', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑结转类型' });
  await expect(edit.getByLabel('转入汇率（本币元/USD）', { exact: true })).toHaveValue('7.1');
  await expect(edit.getByLabel('转入本币单价（元/件）', { exact: true })).toHaveValue('2.55');
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const financialState = async () => ({
    vouchers: await Promise.all(
      (await app.svc.vouchers.list()).items.map((v) => app.svc.vouchers.get(v.id)),
    ),
    opening: await app.svc.opening.list(2026),
    periods: await app.svc.periods.list(),
    logs: await app.svc.log.list(),
  });
  const before = await financialState();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '月度结转预览' });
  await expect(preview).toContainText('合成外币数量');
  await expect(preview).toContainText('USD 100.00 汇率 7.1 数量 278.435294 本币单价 2.55');
  await expect(preview).toContainText('借方 710.01 / 贷方 710.01');
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  await expect(preview).not.toBeVisible();
  expect(await financialState()).toEqual(before);
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '确认生成待审核凭证', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(
    page.getByText('请其他操作员审核结转凭证后，再过账并结账', { exact: true }),
  ).toBeVisible();
  const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ status: 'pending', debitTotal: 71001, creditTotal: 71001 });
  expect(
    (await app.svc.vouchers.get(generated[0]!.id))!.lines.find((l) => l.accountId === target.id),
  ).toMatchObject({
    currency: 'USD',
    exchangeRate: '7.1',
    fcAmount: 10000,
    quantity: '278.435294',
    unitPrice: '2.55',
  });
  await expect(app.svc.vouchers.delete(generated[0]!.id)).rejects.toMatchObject({
    data: { code: 'VOUCHER_FROM_SOURCE' },
  });
});

test('w_zw_ydjz：转入缺少显式映射时在页面报错，补齐前不生成凭证', async ({ page, local }) => {
  const { app, url } = local;
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 100 },
        { account: '4103', credit: 100 },
      ],
    },
  ]);
  await app.call(periodCloseServer).saveRule({
    data: {
      code: 'QTY',
      name: '缺少单价',
      kind: 'custom',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '显式数量结转',
      order: 1,
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('1403')).id,
      sources: [
        { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '100' },
      ],
    },
  });
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  await expect(
    page.getByText('转入科目启用了外币或数量，但尚未填写显式换算设置', { exact: true }),
  ).toBeVisible();
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  expect((await app.svc.periods.require(202601)).status).toBe('open');
});
