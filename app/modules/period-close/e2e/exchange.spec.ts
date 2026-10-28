import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';
import periodCloseServer from '../server';

test.describe.configure({ retries: 0 });
test('w_xt_fbwh / w_pzedit_hlgl_rq：填写期末汇率和辅助汇兑设置，取消不写账，预览制证并合法撤销重建', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const account = await app.svc.accounts.create(
    {
      code: '1701',
      name: '合成外币应收',
      categoryId: 'asset',
      currency: 'USD',
      dimensions: [{ type: 'department', required: true }],
    },
    app.book.codeScheme,
  );
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        {
          account: '1701',
          debit: 71000,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 10000,
          dims: { department: '01' },
        },
        {
          account: '1701',
          credit: 35500,
          currency: 'USD',
          rate: '7.1',
          fcAmount: 5000,
          dims: { department: '02' },
        },
        { account: '4001', credit: 35500 },
      ],
    },
  ]);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  const panel = page.getByRole('region', { name: '汇兑损益', exact: true });
  await expect(panel).toBeVisible();
  const type = panel.getByLabel('汇兑凭证类型', { exact: true });
  await type.click();
  await type.press('ArrowDown');
  await type.press('Enter');
  const selected = panel.getByLabel('需折算的货币性外币科目', { exact: true });
  await selected.fill('1701');
  await selected.press('Enter');
  await selected.press('Escape');
  await panel.getByRole('button', { name: '增加折算币种', exact: true }).click();
  const currency = panel.getByLabel('折算币种', { exact: true });
  await currency.click();
  await currency.press('ArrowDown');
  await currency.press('Enter');
  await panel.getByLabel('期末汇率（每外币单位折合本币元）', { exact: true }).fill('7.2');
  await panel.getByLabel('汇兑损益科目', { exact: true }).fill('6603');
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: '保存汇兑设置', exact: true }).click();
  await expect(panel.getByText('期末汇率及汇兑损益设置已保存', { exact: true })).toBeVisible();
  const api = app.call(periodCloseServer);
  expect((await api.exchangeSettings({ period: 202601 })).settings).toMatchObject({
    accountIds: [account.id],
    rates: [{ currency: 'USD', rate: '7.2' }],
  });
  const before = (await app.svc.vouchers.list()).total;
  await panel.getByRole('button', { name: '汇兑损益预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '汇兑损益预览', exact: true });
  await expect(preview).toContainText('合成外币应收');
  await expect(preview).toContainText('行政部');
  await expect(preview).toContainText('销售部');
  await expect(preview).toContainText('借方 15.00 / 贷方 15.00');
  await preview.getByRole('button', { name: '取消', exact: true }).click();
  expect((await app.svc.vouchers.list()).total).toBe(before);
  await panel.getByRole('button', { name: '汇兑损益预览', exact: true }).click();
  await preview.getByRole('button', { name: '确认生成汇兑凭证', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(
    panel.getByText('汇兑凭证已生成，请其他操作员审核并过账，再办理月度损益结转', { exact: true }),
  ).toBeVisible();
  const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({
    status: 'pending',
    source: { type: 'exchange' },
    debitTotal: 1500,
    creditTotal: 1500,
  });
  expect(
    (await app.svc.vouchers.get(generated[0]!.id))!.lines
      .filter((l) => l.accountId === account.id)
      .every((l) => l.fcAmount === 0),
  ).toBe(true);
  await panel.getByRole('button', { name: '预览撤销汇兑', exact: true }).click();
  const remove = page.getByRole('dialog', { name: '确认撤销汇兑及编号影响', exact: true });
  await remove.getByRole('button', { name: '取消', exact: true }).click();
  expect(await app.svc.vouchers.get(generated[0]!.id)).not.toBeNull();
  await panel.getByRole('button', { name: '预览撤销汇兑', exact: true }).click();
  await remove.getByRole('button', { name: '确认撤销汇兑', exact: true }).click();
  await expect(remove).not.toBeVisible();
  await expect(
    panel.getByText('汇兑凭证已撤销，可修改期末汇率后重新预览生成', { exact: true }),
  ).toBeVisible();
  expect(await app.svc.vouchers.get(generated[0]!.id)).toBeNull();
  await panel.getByLabel('期末汇率（每外币单位折合本币元）', { exact: true }).fill('0');
  await panel.getByRole('button', { name: '保存汇兑设置', exact: true }).click();
  await expect(page.getByText('期末汇率必须大于零', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('期末汇率（每外币单位折合本币元）', { exact: true })).toHaveValue(
    '0',
  );
  expect((await api.exchangeSettings({ period: 202601 })).settings!.rates[0]!.rate).toBe('7.2');
  await panel.getByLabel('期末汇率（每外币单位折合本币元）', { exact: true }).fill('7.3');
  await panel.getByRole('button', { name: '保存汇兑设置', exact: true }).click();
  await expect(panel.getByText('期末汇率及汇兑损益设置已保存', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '汇兑损益预览', exact: true }).click();
  await expect(preview).toContainText('借方 30.00 / 贷方 30.00');
  await preview.getByRole('button', { name: '确认生成汇兑凭证', exact: true }).click();
  await expect(preview).not.toBeVisible();
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).items[0]).toMatchObject({
    debitTotal: 3000,
    creditTotal: 3000,
  });
});
