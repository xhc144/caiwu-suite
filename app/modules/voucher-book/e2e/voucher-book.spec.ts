import { expect, test } from '@playwright/test';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { browserRuntime } from './runtime';
import manifest from '../manifest';

test('w_pz_tjsh 独立账套 A本人跳过 → B审核 → 取消审核 → 红字冲销关联，原件不变', async ({
  page,
}) => {
  const t = await browserRuntime();
  try {
    const cf = (await t.app.svc.dimensions.getByCode('cashflow', 'CF02'))!;
    await t.app.svc.db
      .updateTable('dimension_item')
      .set({ attrs: JSON.stringify({ cashflowDirection: 'outflow' }) })
      .where('id', '=', cf.id)
      .execute();
    const vs = await seedVouchers(
      t.app.svc,
      [1, 2].map((n) => ({
        date: '2026-01-05',
        summary: `独立凭证${n}`,
        lines: [
          { account: '6603', debit: n },
          { account: '1001', credit: n, dims: { cashflow: 'CF02' } },
        ],
      })),
    );
    await t.app.addUser('B', { password: 'b', permissions: manifest.permissions.map((p) => p.id) });
    await t.login(page, 'admin', 'admin');
    await expect(page.getByRole('heading', { name: '凭证序时簿', exact: true })).toBeVisible();
    await page.getByText(/当前查询全部结果/).click();
    await page.getByRole('button', { name: '批量审核', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(dialog).toContainText('可处理 0 张，跳过 2 张');
    await expect(dialog.getByText('制单人与审核人相同，请更换用户后审核')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: '确认执行' })).toBeDisabled();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await t.login(page, 'B', 'b');
    await page.getByText(/当前查询全部结果/).click();
    await page.getByRole('button', { name: '批量审核', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '审核预览', exact: true });
    await expect(dialog).toContainText('可处理 2 张，跳过 0 张');
    await dialog.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByText('成功 2 张，跳过 0 张', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '独立凭证1' })).toContainText('B');
    await page.getByRole('button', { name: '取消审核', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '取消审核预览', exact: true });
    await expect(dialog).toContainText('清除审核人和审核日期');
    await dialog.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByRole('row').filter({ hasText: '独立凭证1' })).toContainText('待审核');
    const original = (await t.app.svc.vouchers.get(vs[0]!.id))!;
    await page.getByText(/当前查询全部结果/).click();
    await page.getByRole('row').filter({ hasText: '独立凭证1' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '红字冲销', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '红字冲销设置', exact: true });
    await dialog.getByLabel('目标日期', { exact: true }).fill('2026-02-01');
    await dialog.getByRole('button', { name: '生成预览' }).click();
    dialog = page.getByRole('dialog', { name: '红字冲销预览', exact: true });
    await expect(dialog).toContainText('-0.01');
    await dialog.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByText('成功 1 张，跳过 0 张', { exact: true })).toBeVisible();
    const reverse = (await t.app.svc.vouchers.list({ sourceModule: 'voucher-book' })).items[0]!;
    expect(reverse.reversalOfId).toBe(original.id);
    expect(reverse.debitTotal).toBe(-1);
    expect(await t.app.svc.vouchers.get(original.id)).toEqual(original);
    const reverseRow = page.getByRole('row').filter({ hasText: `冲销 #${original.id}` });
    await expect(reverseRow).toContainText('-0.01');
    await reverseRow.getByRole('button', { name: '浏览', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '凭证浏览', exact: true });
    await expect(dialog.getByRole('link', { name: `原凭证 #${original.id}` })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭' }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '独立凭证1' })
      .first()
      .getByRole('button', { name: '浏览', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: '凭证浏览', exact: true })).toContainText(
      `冲销凭证 #${reverse.id}`,
    );
  } finally {
    await t.close();
  }
});

test('w_pz_pzxsb 插入/重排取消不变，筛选URL与跨模块路由，导出再导入，错误文件不写库，来源只读', async ({
  page,
}) => {
  const t = await browserRuntime();
  try {
    const [v] = await seedVouchers(t.app.svc, [
      {
        date: '2026-01-05',
        summary: '往返测试',
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      },
    ]);
    {
      const numberPlan = await t.app.svc.vouchers.previewNumbers([{ id: v!.id, number: 3 }]);
      await t.app.svc.vouchers.setNumbers(numberPlan.updates, {
        plan: numberPlan,
        confirmed: true,
      });
    }
    const before = await t.app.svc.vouchers.get(v!.id);
    await t.login(page, 'admin', 'admin');
    await page.getByRole('row').filter({ hasText: '往返测试' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '插入', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '插入设置', exact: true });
    await dialog.getByRole('button', { name: '生成预览' }).click();
    dialog = page.getByRole('dialog', { name: '插入预览', exact: true });
    await expect(dialog).toContainText('已打印凭证和账册失配');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await t.app.svc.vouchers.get(v!.id)).toEqual(before);
    await page.getByRole('button', { name: '编号整理', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '编号整理设置', exact: true });
    await dialog.getByLabel('期间', { exact: true }).fill('202601');
    const type = dialog.getByLabel('目标凭证类型', { exact: true });
    await type.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: '生成预览' }).click();
    dialog = page.getByRole('dialog', { name: '编号整理预览', exact: true });
    await expect(dialog).toContainText('旧号');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await t.app.svc.vouchers.get(v!.id)).toEqual(before);
    await page.getByLabel('金额起（元）', { exact: true }).fill('0.01');
    await page.getByLabel('金额止（元）', { exact: true }).fill('0.01');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page).toHaveURL(/amountFrom=1/);
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: '往返测试' })).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
    const download = await downloadPromise;
    const filePath = await download.path();
    await page.getByRole('button', { name: '导入 / 转入', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '凭证导入 / 转入', exact: true });
    await dialog.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: '往返.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await import('node:fs/promises').then((fs) => fs.readFile(filePath!)),
    });
    await dialog.getByLabel('目标日期（留空保留原日期）', { exact: true }).fill('2026-02-01');
    await dialog.getByRole('button', { name: '逐凭证预览' }).click();
    await expect(dialog).toContainText('合法 1 张；错误 0 项');
    await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
    await expect(page.getByText('导入 1 张，跳过 0 张', { exact: true })).toBeVisible();
    expect((await t.app.svc.vouchers.list({})).total).toBe(2);
    await page.getByRole('button', { name: '导入 / 转入', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '凭证导入 / 转入', exact: true });
    await dialog.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: '损坏.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('invalid excel'),
    });
    await dialog.getByRole('button', { name: '逐凭证预览' }).click();
    await expect(
      page.getByText('Excel 文件无法读取，请检查文件是否完整', { exact: true }),
    ).toBeVisible();
    expect((await t.app.svc.vouchers.list({})).total).toBe(2);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    const foreign = await t.app.svcFor('cashier').vouchers.create({
      ...(await voucherInputFromSpec(t.app.svc, {
        date: '2026-01-06',
        summary: '其它模块来源',
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      })),
      source: { type: 'document', id: 'D1' },
    });
    await page.getByRole('button', { name: '刷新 F5', exact: true }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '其它模块来源' })
      .getByRole('button', { name: '浏览', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: '凭证浏览', exact: true });
    await expect(dialog).toContainText('由来源单据生成，请在来源页面处理');
    await expect(dialog).not.toContainText('cashier');
    await dialog.getByRole('button', { name: '关闭' }).click();
    const row = page.getByRole('row').filter({ hasText: '其它模块来源' });
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '删除预览', exact: true });
    await expect(dialog).toContainText('凭证由其他业务生成，请到来源单据处理');
    await expect(dialog).not.toContainText('cashier');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await row.getByRole('button', { name: '打开', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/m/voucher-entry/edit\\?id=${foreign.id}`));
  } finally {
    await t.close();
  }
});

test('w_pz_plxg / 插入 独立页面完成平衡插入和批量改日期，编号影响再次确认', async ({ page }) => {
  const t = await browserRuntime();
  try {
    await seedVouchers(t.app.svc, [
      {
        date: '2026-01-05',
        summary: '插入原件',
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      },
    ]);
    await t.login(page, 'admin', 'admin');
    await page.getByRole('row').filter({ hasText: '插入原件' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: '插入', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: '插入设置', exact: true });
    await dialog.getByLabel('第1行摘要', { exact: true }).fill('新插入的完整凭证');
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '插入预览', exact: true });
    await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /确认编号变化/ }).check();
    await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '新插入的完整凭证' })).toContainText(
      '记-0001',
    );
    await expect(page.getByRole('row').filter({ hasText: '插入原件' })).toContainText('记-0002');
    await page
      .getByRole('row')
      .filter({ hasText: '新插入的完整凭证' })
      .getByRole('checkbox')
      .check();
    await page.getByRole('button', { name: '批量修改', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '批量修改设置', exact: true });
    await dialog.getByLabel('目标日期', { exact: true }).fill('2026-02-01');
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '批量修改预览', exact: true });
    await expect(dialog).toContainText('不会更改账套编号模式');
    await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /再次确认修改日期或类型/ }).check();
    await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '新插入的完整凭证' })).toContainText(
      '2026-02-01',
    );
    expect((await t.app.svc.vouchers.list({})).total).toBe(2);
  } finally {
    await t.close();
  }
});

test('w_pz_zhcx / w_pz_kmhz / w_pz_ttsee 条件前后退、非法日期阻止、当前范围报表及导出', async ({
  page,
}) => {
  const t = await browserRuntime();
  try {
    await seedVouchers(
      t.app.svc,
      [1, 2].map((amount) => ({
        date: '2026-01-05',
        summary: `报告样本${amount}`,
        lines: [
          { account: '6603', debit: amount },
          { account: '1001', credit: amount },
        ],
      })),
    );
    await t.login(page, 'admin', 'admin');
    await page.getByRole('button', { name: '添加查询条件', exact: true }).click();
    await page.getByLabel('综合查询值1', { exact: true }).fill('样本1');

    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '报告样本1' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '报告样本2' })).toHaveCount(0);
    await page.getByLabel('综合查询值1', { exact: true }).fill('样本2');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '报告样本2' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('综合查询值1', { exact: true })).toHaveValue('样本1');
    await expect(page.getByRole('row').filter({ hasText: '报告样本1' })).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel('综合查询值1', { exact: true })).toHaveValue('样本2');
    await page.goto(`${t.address}/m/voucher-book?dateFrom=2026-02-30`);
    await expect(page.getByText('查询条件有误，未执行查询', { exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: /报告样本/ })).toHaveCount(0);
    await page.goto(`${t.address}/m/voucher-book/summary?period=202601&amountFrom=2&amountTo=2`);
    await expect(page.getByRole('heading', { name: '凭证科目汇总', exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '6603' })).toContainText('0.02');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前范围', exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toBe('凭证科目汇总.xlsx');
    await page.goto(
      `${t.address}/m/voucher-book/t-account?period=202601&account=6603&amountFrom=2&amountTo=2`,
    );
    await expect(page.getByRole('heading', { name: '借方 合计 0.02', exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '报告样本2' })).toBeVisible();
    await page.getByRole('link', { name: '记-0002', exact: true }).click();
    await expect(page).toHaveURL(/\/m\/voucher-book\?id=2$/);
  } finally {
    await t.close();
  }
});

test('w_pz_pzxsb 未预览的插入稿在前后退后保留，其他标签页未提交条件不丢失且不写库', async ({
  page,
}) => {
  const t = await browserRuntime();
  try {
    const originals = await seedVouchers(
      t.app.svc,
      [1, 2].map((amount) => ({
        date: '2026-01-05',
        summary: `导航原件${amount}`,
        lines: [
          { account: '6603', debit: amount },
          { account: '1001', credit: amount },
        ],
      })),
    );
    await t.login(page, 'admin', 'admin');
    await expect(page.getByRole('heading', { name: '凭证序时簿', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '科目汇总', exact: true }).click();
    await page
      .getByRole('tabpanel', { name: '凭证科目汇总', exact: true })
      .getByLabel('摘要', { exact: true })
      .fill('其他标签页未提交条件');
    await page.getByRole('tab', { name: '凭证序时簿', exact: true }).click();
    const book = page.getByRole('tabpanel', { name: '凭证序时簿', exact: true });
    await book.getByLabel('摘要', { exact: true }).fill('导航原件');
    await book.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '导航原件');
    await expect(book.getByRole('row').filter({ hasText: '导航原件1' })).toBeVisible();
    await book.getByLabel('摘要', { exact: true }).fill('导航原件2');
    await book.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '导航原件2');
    await expect(book.getByRole('row').filter({ hasText: '导航原件1' })).toHaveCount(0);
    await book.getByRole('row').filter({ hasText: '导航原件2' }).getByRole('checkbox').check();
    await book.getByRole('button', { name: '插入', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '插入设置', exact: true });
    await drawer.getByLabel('第1行摘要', { exact: true }).fill('尚未预览的插入摘要');
    await drawer.getByLabel('第2行摘要', { exact: true }).fill('尚未预览的贷方摘要');
    await drawer.getByLabel('借方', { exact: true }).nth(0).fill('12.34');
    await drawer.getByLabel('贷方', { exact: true }).nth(1).fill('12.34');
    await drawer.getByLabel('目标日期', { exact: true }).click();
    const documentIdentity = await page.evaluateHandle(() => document);
    const expectDraft = async () => {
      expect(await page.evaluate((previous) => previous === document, documentIdentity)).toBe(true);
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('第1行摘要', { exact: true })).toHaveValue(
        '尚未预览的插入摘要',
      );
      await expect(drawer.getByLabel('第2行摘要', { exact: true })).toHaveValue(
        '尚未预览的贷方摘要',
      );
      await expect(drawer.getByLabel('借方', { exact: true }).nth(0)).toHaveValue('12.34');
      await expect(drawer.getByLabel('贷方', { exact: true }).nth(1)).toHaveValue('12.34');
      expect((await t.app.svc.vouchers.list({ includeVoided: true })).total).toBe(2);
      for (const original of originals)
        expect(await t.app.svc.vouchers.get(original.id)).toEqual(original);
    };
    await page.goBack();
    await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '导航原件');
    await expectDraft();
    await page.goForward();
    await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '导航原件2');
    await expectDraft();
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('tab', { name: '凭证科目汇总', exact: true }).click();
    await expect(
      page
        .getByRole('tabpanel', { name: '凭证科目汇总', exact: true })
        .getByLabel('摘要', { exact: true }),
    ).toHaveValue('其他标签页未提交条件');
    expect(await page.evaluate((previous) => previous === document, documentIdentity)).toBe(true);
    await documentIdentity.dispose();
  } finally {
    await t.close();
  }
});
