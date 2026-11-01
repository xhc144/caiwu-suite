import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect, type Isolated } from './fixture';

async function setup(page: Parameters<typeof loginWithNewBook>[0], isolated: Isolated) {
  const { bookId } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  await isolated.seed(bookId, async (svc) => {
    await seedVouchers(svc, [
      {
        date: '2026-01-10',
        status: 'posted',
        lines: [
          { account: '1122', debit: 12345, dims: { partner: 'C001' } },
          { account: '6001', credit: 12345 },
        ],
      },
    ]);
  });
}
test('w_fx_main / w_fx_def / w_fx_demo：新增定义→公式→分析→调整→保存→重开', async ({
  page,
  isolated,
}) => {
  await setup(page, isolated);
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page.getByRole('button', { name: '新增分析表' }).click();
  const definition = page.getByRole('dialog', { name: '自定义分析定义', exact: true });
  await definition.getByLabel('分析编号').fill('1');
  await definition.getByLabel('分析名称').fill('应收分析');
  await definition.getByLabel('项目1名称').fill('应收发生');
  await definition.getByLabel('项目1公式').fill('借方("1122")');
  await definition.getByRole('button', { name: '增加项目' }).click();
  await definition.getByLabel('项目2名称').fill('小计');
  await definition.getByLabel('项目2公式').fill('项目(1) * 2');
  await definition.getByLabel('项目2小计').check();
  await definition.getByRole('button', { name: '保存分析定义' }).click();
  await expect(definition.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await definition.getByRole('button', { name: '关闭定义' }).click();
  const row = page.getByRole('row').filter({ hasText: '001' });
  await expect(row).toContainText('应收分析');
  await row.getByRole('button', { name: '分析', exact: true }).click();
  const result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await expect(result.getByLabel('1-202601')).toHaveValue('123.45');
  await expect(result.getByLabel('2-202601')).toHaveValue('246.90');
  await result.getByLabel('1-202601').fill('130.00');
  await result.getByLabel('结果名称').fill('应收分析调整稿');
  await result.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(result.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await result.getByRole('button', { name: '关闭结果', exact: true }).click();
  await page.getByRole('link', { name: '已保存分析结果', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '应收分析调整稿' })
    .getByRole('button', { name: '打开结果' })
    .click();
  await expect(result.getByLabel('1-202601')).toHaveValue('130.00');
  await result.getByLabel('显示取数原值').check();
  await expect(result.getByText('原值：123.45')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await result.getByRole('button', { name: '导出当前稿 Excel' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('应收分析调整稿.xlsx');
});

test('w_fx_def 未保存离开及错误公式不丢稿；w_fx_nd_1 年度结果保存重开', async ({
  page,
  isolated,
}) => {
  await setup(page, isolated);
  await page.goto(`${isolated.origin}/m/analysis/custom`);
  await page.getByRole('button', { name: '新增分析表' }).click();
  const definition = page.getByRole('dialog', { name: '自定义分析定义', exact: true });
  await definition.getByLabel('分析编号').fill('2');
  await definition.getByLabel('分析名称').fill('待修公式');
  await definition.getByLabel('项目1名称').fill('应收');
  await definition.getByLabel('项目1公式').fill('(1 + 2');
  await definition.getByRole('button', { name: '保存分析定义' }).click();
  await expect(definition.getByText('分析定义未保存，输入仍保留')).toBeVisible();
  await definition.getByRole('button', { name: '关闭定义' }).click();
  const confirm = page.getByRole('dialog', { name: '分析定义尚未保存' });
  await confirm.getByRole('button', { name: '继续编辑' }).click();
  await expect(definition.getByLabel('项目1公式')).toHaveValue('(1 + 2');
  await definition.getByRole('button', { name: '关闭定义' }).click();
  await page
    .getByRole('dialog', { name: '分析定义尚未保存' })
    .getByRole('button', { name: '放弃修改' })
    .click();
  await page.goto(`${isolated.origin}/m/analysis?accountCode=1122&period=202601&mode=annual`);
  await page.getByRole('button', { name: '编辑并保存结果' }).click();
  const result = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await expect(result.getByLabel('1122-202601')).toHaveValue('123.45');
  await result.getByLabel('1122-202601').fill('120.00');
  await result.getByLabel('结果名称').fill('年度手工调整');
  await result.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(result.getByText('已保存版本 1', { exact: false })).toBeVisible();
  await result.getByRole('button', { name: '关闭结果', exact: true }).click();
  await page.getByRole('link', { name: '已保存分析结果', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: '年度手工调整' })
    .getByRole('button', { name: '打开结果' })
    .click();
  await expect(result.getByLabel('1122-202601')).toHaveValue('120.00');
  await expect(result.getByRole('cell', { name: '10.00', exact: true })).toBeVisible();
});

test('w_fx_nd_1 保存请求失败保稿，关闭前保存失败仍留在编辑页，重试可恢复', async ({
  page,
  isolated,
}) => {
  await setup(page, isolated);
  await page.goto(`${isolated.origin}/m/analysis?accountCode=1122&period=202601&mode=annual`);
  await page.getByRole('button', { name: '编辑并保存结果' }).click();
  const editor = page.getByRole('dialog', { name: '分析结果编辑与保存' });
  await editor.getByLabel('1122-202601').fill('180.25');
  await editor.getByLabel('结果名称').fill('失败后保留稿');
  await page.route('**/trpc/*', async (route) => {
    if (route.request().url().includes('m.analysis.results.save')) await route.abort('failed');
    else await route.continue();
  });
  await editor.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(editor.getByText('保存未完成，当前输入仍保留')).toBeVisible();
  await expect(editor.getByLabel('1122-202601')).toHaveValue('180.25');
  await editor.getByRole('button', { name: '关闭结果' }).click();
  const confirm = page.getByRole('dialog', { name: '分析结果尚未保存' });
  await confirm.getByRole('button', { name: '保存后关闭' }).click();
  await expect(editor.getByLabel('1122-202601')).toHaveValue('180.25');
  await confirm.getByRole('button', { name: '继续编辑' }).click();
  await page.unroute('**/trpc/*');
  await editor.getByRole('button', { name: '保存分析结果', exact: true }).click();
  await expect(editor.getByText('已保存版本 1', { exact: false })).toBeVisible();
});
