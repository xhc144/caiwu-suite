import { seedVouchers } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { test, expect } from './fixture';

test.describe.configure({ retries: 0 });

test('w_zw_ydjz_1_bak：逐项预览制证，保存失败后刷新恢复，明确跳过并按真实成功基数继续', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const api = app.call(periodCloseServer);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 101 },
        { account: '1001', credit: 101 },
      ],
    },
  ]);
  const accountId = async (code: string) => (await app.svc.accounts.require(code)).id;
  for (const [code, order, source, target, ratio] of [
    ['A', 1, '4001', '4103', '50'],
    ['B', 2, '4103', '4104', '100'],
    ['C', 3, '4103', '1601', '100'],
  ] as const) {
    await api.saveRule({
      data: {
        code,
        name: `合成结转${code}`,
        kind: 'custom',
        order,
        voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
        summary: '合成逐项结转',
        enabled: true,
        targetAccountId: await accountId(target),
        sources: [{ accountId: await accountId(source), mode: 'balance', ratio }],
      },
    });
  }
  app.runtime.bookStore
    .open(app.book.id)
    .raw.exec(
      "CREATE TRIGGER period_close_batch_e2e_fail BEFORE INSERT ON period_close_run WHEN NEW.rule_id = 2 BEGIN SELECT RAISE(ABORT,'合成B保存失败'); END",
    );
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  const panel = page
    .locator('.ant-card')
    .filter({ has: page.getByText('逐项结转（失败后可继续）', { exact: true }) });
  await panel
    .getByRole('checkbox', { name: '已确认逐项结转顺序；失败后由我选择是否继续', exact: true })
    .check();
  await panel.getByRole('button', { name: '开始逐项结转', exact: true }).click();
  await expect(panel).toContainText('已处理 0/3 项');
  await panel.getByRole('button', { name: '预览当前结转 A', exact: true }).click();
  const firstPreview = page.getByRole('dialog', { name: '逐项结转预览：A', exact: true });
  await expect(firstPreview).toContainText('借方 0.51 / 贷方 0.51');
  await firstPreview
    .getByRole('checkbox', { name: '已确认本项金额和分录，执行后再预览下一项', exact: true })
    .check();
  await firstPreview.getByRole('button', { name: '确认生成本项并继续', exact: true }).click();
  await expect(firstPreview).not.toBeVisible();
  await expect(panel).toContainText('已处理 1/3 项');
  await panel.getByRole('button', { name: '预览当前结转 B', exact: true }).click();
  const failedPreview = page.getByRole('dialog', { name: '逐项结转预览：B', exact: true });
  await failedPreview.getByRole('checkbox').check();
  await failedPreview.getByRole('button', { name: '确认生成本项并继续', exact: true }).click();
  await expect(panel).toContainText('本项失败，等待选择');
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  await page.reload();
  await expect(panel).toContainText('本项失败，等待选择');
  await expect(panel).toContainText('A 合成结转A：已生成待审核凭证');
  await panel.getByRole('button', { name: '跳过失败项，继续其余结转', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await expect(panel).toContainText('B 合成结转B：明确跳过，未生成凭证');
  await panel.getByRole('button', { name: '预览当前结转 C', exact: true }).click();
  const finalPreview = page.getByRole('dialog', { name: '逐项结转预览：C', exact: true });
  await expect(finalPreview).toContainText('借方 0.51 / 贷方 0.51');
  await finalPreview.getByRole('button', { name: '取消', exact: true }).click();
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  await panel.getByRole('button', { name: '预览当前结转 C', exact: true }).click();
  await finalPreview.getByRole('checkbox').check();
  await finalPreview.getByRole('button', { name: '确认生成本项并继续', exact: true }).click();
  await expect(panel).toContainText('批次已结束，存在跳过项，请核对后补转');
  const output = await api.transferBatch({ period: 202601 });
  expect(output!.state.results.map((r) => r.status)).toEqual(['generated', 'skipped', 'generated']);
  const vouchers = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
  expect(vouchers).toHaveLength(2);
  expect(
    vouchers.every((v) => v.status === 'pending' && v.debitTotal === 51 && v.creditTotal === 51),
  ).toBe(true);
});

test('w_zw_ydjz_1_bak：手工编号逐项结转先填号码，冲突后重新检查并改号成功', async ({
  page,
  local,
}) => {
  const { app, url } = local;
  const api = app.call(periodCloseServer);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 100 },
        { account: '1001', credit: 100 },
      ],
    },
  ]);
  await api.saveRule({
    data: {
      code: 'MANUAL',
      name: '手工编号结转',
      kind: 'custom',
      order: 1,
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '合成手工编号',
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('4103')).id,
      sources: [
        { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '100' },
      ],
    },
  });
  await app.svc.voucherPolicy.set({
    numbering: 'manual',
    renumberAfterDelete: false,
    allowModifyOthers: true,
  });
  await local.login(page);
  await page.goto(`${url}/m/period-close?period=202601`);
  const panel = page
    .locator('.ant-card')
    .filter({ has: page.getByText('逐项结转（失败后可继续）', { exact: true }) });
  await panel
    .getByRole('checkbox', { name: '已确认逐项结转顺序；失败后由我选择是否继续', exact: true })
    .check();
  await panel.getByRole('button', { name: '开始逐项结转', exact: true }).click();
  await panel.getByRole('button', { name: '预览当前结转 MANUAL', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '逐项结转预览：MANUAL', exact: true });
  await modal.getByRole('checkbox').check();
  await expect(
    modal.getByRole('button', { name: '确认生成本项并继续', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('spinbutton', { name: '本项凭证号', exact: true }).fill('1');
  await modal.getByRole('button', { name: '确认生成本项并继续', exact: true }).click();
  await expect(panel).toContainText('本项失败，等待选择');
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  await panel.getByRole('button', { name: '重新检查并重试本项', exact: true }).click();
  await panel.getByRole('button', { name: '预览当前结转 MANUAL', exact: true }).click();
  await expect(modal.getByRole('spinbutton', { name: '本项凭证号', exact: true })).toHaveValue('');
  await modal.getByRole('spinbutton', { name: '本项凭证号', exact: true }).fill('12');
  await modal.getByRole('checkbox').check();
  await modal.getByRole('button', { name: '确认生成本项并继续', exact: true }).click();
  await expect(panel).toContainText('本批次结转已处理完毕');
  expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).items).toMatchObject([
    { number: 12, status: 'pending', debitTotal: 100, creditTotal: 100 },
  ]);
});
