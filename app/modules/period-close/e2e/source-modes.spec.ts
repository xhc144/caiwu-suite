import { seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { test, expect } from './fixture';

test.describe.configure({ retries: 0 });

test('w_xt_jzwh：选择本期贷方发生额、保存重开并从预览生成真实结转凭证', async ({ page, local }) => {
  const { app, url } = local;
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 10000 },
        { account: '4001', credit: 2000 },
        { account: '4001', debit: -500 },
        { account: '4104', credit: 7500 },
      ],
    },
  ]);
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  await page.getByRole('button', { name: '新增结转类型', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '新增结转类型' });
  await drawer.getByLabel('代码', { exact: true }).fill('CREDIT');
  await drawer.getByLabel('说明', { exact: true }).fill('按贷方发生额结转');
  await drawer.getByLabel('结转内容', { exact: true }).click();
  await page.getByText('自定义科目余额比例', { exact: true }).click();
  const voucherType = drawer.getByLabel('凭证类型', { exact: true });
  await voucherType.click();
  await voucherType.press('ArrowDown');
  await voucherType.press('Enter');
  await drawer.getByLabel('唯一转入末级科目', { exact: true }).fill('4103');
  await page.keyboard.press('Enter');
  await drawer.getByRole('button', { name: '增加转出科目', exact: true }).click();
  await drawer.getByLabel('转出科目', { exact: true }).fill('4001');
  await page.keyboard.press('Enter');
  await drawer.getByLabel('转出类型', { exact: true }).click();
  await page.getByText('本期贷方发生额', { exact: true }).click();
  await drawer.getByLabel('比例（%）', { exact: true }).fill('50');
  await drawer.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const api = app.call(periodCloseServer);
  expect((await api.rules())[0]!.sources[0]).toMatchObject({ mode: 'periodCredit', ratio: '50' });
  const row = page.getByRole('row').filter({ has: page.getByText('CREDIT', { exact: true }) });
  await row.getByRole('button', { name: '编辑 / 启停', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑结转类型' });
  await expect(edit.locator('.ant-select').filter({ hasText: '本期贷方发生额' })).toHaveCount(1);
  await expect(edit.getByLabel('比例（%）', { exact: true })).toHaveValue('50');
  await edit.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '结转预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '月度结转预览' });
  await expect(preview).toContainText('借方 10.00 / 贷方 10.00');
  await expect(preview).toContainText('4001 实收资本 借 10.00 贷 0.00');
  await expect(preview).toContainText('4103 本年利润 借 0.00 贷 10.00');
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '确认生成待审核凭证', exact: true }).click();
  await expect(preview).not.toBeVisible();
  const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ status: 'pending', debitTotal: 1000, creditTotal: 1000 });
  expect((await app.svc.vouchers.get(generated[0]!.id))!.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        accountId: (await app.svc.accounts.require('4001')).id,
        debit: 1000,
        credit: 0,
      }),
      expect.objectContaining({
        accountId: (await app.svc.accounts.require('4103')).id,
        debit: 0,
        credit: 1000,
      }),
    ]),
  );
});
