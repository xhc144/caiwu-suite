import { expect, test, request as requestFactory, type Page } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { fixture } from './fixture';

async function select(page: Page, label: string, value: string) {
  await page.getByRole('combobox', { name: label, exact: true }).fill(value);
  await page.keyboard.press('Enter');
}

test('w_pz_pzedit：全键盘三行、部门项目和 USD → Ctrl+S → 重开 → 差1分阻止 → 草稿刷新 → 双标签冲突 → 已审核只读', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const local = await fixture();
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    const [audited] = await seedVouchers(svc, [
      {
        date: '2026-01-05',
        status: 'audited',
        lines: [
          { account: '6603', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-01-10');
    await page.getByLabel('第1行摘要', { exact: true }).fill('键盘费用');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: '第1行科目', exact: true })).toBeFocused();
    await select(page, '第1行科目', 'glfy');
    await select(page, '第1行部门', '01');
    await select(page, '第1行项目', 'XM01');
    await page.getByLabel('第1行借方', { exact: true }).fill('100');
    await page.getByLabel('第2行摘要', { exact: true }).fill('美元收款');
    await select(page, '第2行科目', '100202');
    await select(page, '第2行现金流量', 'CF01');
    await page.getByLabel('第2行借方', { exact: true }).fill('71');
    await page.keyboard.press('F6');
    const detail = page.getByRole('dialog', { name: '第2行分录信息' });
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel('第2行汇率', { exact: true })).toHaveValue('7.1');
    await detail.getByLabel('第2行原币金额', { exact: true }).fill('10');
    await page.keyboard.press('Escape');
    await page.getByLabel('第3行摘要', { exact: true }).fill('收入合计');
    await select(page, '第3行科目', '6001');
    await page.getByLabel('第3行贷方', { exact: true }).fill('171');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('已保存 记-0002');
    const { items } = await svc.vouchers.list({ summaryContains: '键盘费用' });
    const saved = (await svc.vouchers.get(items[0]!.id))!;
    expect(saved.lines.map((l) => [l.summary, l.accountCode, l.debit, l.credit])).toEqual([
      ['键盘费用', '6602', 10000, 0],
      ['美元收款', '100202', 7100, 0],
      ['收入合计', '6001', 0, 17100],
    ]);
    expect(saved.lines[0]?.dimensions).toMatchObject({
      department: (await svc.dimensions.getByCode('department', '01'))!.id,
      project: (await svc.dimensions.getByCode('project', 'XM01'))!.id,
    });
    expect(saved.lines[1]).toMatchObject({ currency: 'USD', exchangeRate: '7.1', fcAmount: 1000 });
    await page.getByRole('link', { name: '重新打开凭证', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${saved.id}`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('键盘费用');
    await expect(page.getByLabel('第3行贷方', { exact: true })).toHaveValue('171.00');
    await expect(page.locator('[data-line="0"]')).toContainText('01 行政部');
    await expect(page.locator('[data-line="0"]')).toContainText('XM01');
    await page.getByLabel('第2行借方', { exact: true }).focus();
    await page.keyboard.press('F6');
    await expect(
      page
        .getByRole('dialog', { name: '第2行分录信息' })
        .getByLabel('第2行原币金额', { exact: true }),
    ).toHaveValue('10.00');
    await page.keyboard.press('Escape');
    await page.getByLabel('第3行贷方', { exact: true }).fill('170.99');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('difference')).toContainText('0.01');
    await expect(page.getByRole('alert').filter({ hasText: '借贷不平衡' }).first()).toBeVisible();
    expect((await svc.vouchers.get(saved.id))!.creditTotal).toBe(17100);

    // 第二个浏览器标签页用同一身份，直接打开本模块；没有跨模块造前置。
    const beforeFix = (await svc.vouchers.get(saved.id))!.revision;
    await page.getByLabel('第3行贷方', { exact: true }).fill('171');
    await page.keyboard.press('Control+s');
    await expect
      .poll(async () => (await svc.vouchers.get(saved.id))!.revision)
      .toBeGreaterThan(beforeFix);
    const other = await context.newPage();
    const session = await page.evaluate(() => sessionStorage.getItem('caiwu.session'));
    await other.addInitScript((raw) => {
      if (raw) sessionStorage.setItem('caiwu.session', raw);
    }, session);
    await other.goto(`${local.url}/m/voucher-entry/edit?id=${saved.id}`);
    await expect(other.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('窗口一修改');
    await page.keyboard.press('Control+s');
    await expect
      .poll(async () => (await svc.vouchers.get(saved.id))!.lines[0]!.summary)
      .toBe('窗口一修改');
    await other.getByLabel('第1行摘要', { exact: true }).fill('窗口二过期修改');
    await other.keyboard.press('Control+s');
    await expect(other.getByRole('alert').filter({ hasText: '版本冲突' }).first()).toBeVisible();
    expect((await svc.vouchers.get(saved.id))!.lines[0]?.summary).toBe('窗口一修改');
    await other.close();

    // 新编辑器的自动草稿及无科目缓冲刷新恢复。
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith('voucher-entry.new.')) sessionStorage.removeItem(key);
    });
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('自动草稿行');
    await select(page, '第1行科目', '6603');
    await page.getByLabel('第1行借方', { exact: true }).fill('12.34');
    await page.getByLabel('第2行摘要', { exact: true }).fill('无科目缓冲也恢复');
    await expect(page.getByRole('status')).toContainText('草稿与编辑缓冲已保存');
    await page.reload();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('自动草稿行');
    await expect(page.getByLabel('第2行摘要', { exact: true })).toHaveValue('无科目缓冲也恢复');
    const drafts = await svc.vouchers.list({ statuses: ['draft'] });
    expect(drafts.items.some((v) => v.number == null)).toBe(true);
    await page.goto(`${local.url}/m/voucher-entry/edit?id=${audited!.id}`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert').filter({ hasText: '当前凭证只读' })).toBeVisible();
    await page.getByRole('button', { name: '去审核', exact: true }).click();
    await expect(page).toHaveURL(/\/m\/voucher-book\?period=202601&status=pending$/);
  } finally {
    await request.dispose();
    await local.close();
  }
});

test('m_work_pz_pzedit / w_pz_pzmb_main：IME、快捷键、Excel取消与确认、模板事务维护', async ({
  page,
}) => {
  test.setTimeout(90000);
  const local = await fixture();
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    const countRows = () => page.locator('table[aria-label="分录网格"] tbody tr');
    const resize = page.getByRole('separator', { name: '调整摘要列宽' });
    const width = Number(await resize.getAttribute('aria-valuenow'));
    await resize.focus();
    await page.keyboard.press('ArrowRight');
    await expect(resize).toHaveAttribute('aria-valuenow', String(width + 16));
    await page.reload();
    await expect(page.getByRole('status')).toContainText('已恢复');
    await expect(page.getByRole('separator', { name: '调整摘要列宽' })).toHaveAttribute(
      'aria-valuenow',
      String(width + 16),
    );
    await page.getByLabel('第1行摘要', { exact: true }).focus();
    await page
      .getByLabel('第1行摘要', { exact: true })
      .dispatchEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true });
    await page
      .getByLabel('第1行摘要', { exact: true })
      .dispatchEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, isComposing: true });
    await expect(countRows()).toHaveCount(3);
    await expect(page.getByRole('status')).toContainText('已恢复');
    expect((await svc.vouchers.list({})).total).toBe(0);
    await page.keyboard.press('Control+i');
    await expect(countRows()).toHaveCount(4);
    await page.keyboard.press('Control+k');
    await expect(countRows()).toHaveCount(3);
    await page.keyboard.press('Control+i');
    await page.keyboard.press('Control+d');
    await expect(countRows()).toHaveCount(3);
    await page.getByLabel('第1行摘要', { exact: true }).fill('取消粘贴保留此内容');
    await select(page, '第1行科目', '6603');
    await page.getByLabel('第1行借方', { exact: true }).fill('10.01');
    await page.keyboard.press('F7');
    await expect(countRows()).toHaveCount(4);
    await expect(page.getByLabel('第2行贷方', { exact: true })).toHaveValue('10.01');
    await page.keyboard.press('F8');
    await expect(page.getByLabel('第2行借方', { exact: true })).toHaveValue('10.01');
    await page.keyboard.press('Control+d');
    await expect(countRows()).toHaveCount(3);
    await page.getByRole('button', { name: 'Excel 粘贴', exact: true }).click();
    let paste = page.getByRole('dialog', { name: 'Excel 粘贴：映射与预览' });
    await paste.getByLabel('Excel粘贴文本').fill('坏行\t财务费用\t1\t0');
    const previewRequest = page.waitForRequest((req) =>
      req.url().includes('m.voucher-entry.paste'),
    );
    await paste.getByRole('button', { name: '解析预览' }).click();
    expect((await previewRequest).method()).toBe('POST');
    await expect(paste).toContainText('科目编码不存在');
    await expect(paste.getByRole('button', { name: '确认替换分录' })).toBeDisabled();
    await paste.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('取消粘贴保留此内容');
    expect((await svc.vouchers.list({ summaryContains: '坏行' })).total).toBe(0);
    await page.getByRole('button', { name: 'Excel 粘贴', exact: true }).click();
    paste = page.getByRole('dialog', { name: 'Excel 粘贴：映射与预览' });
    await paste
      .getByLabel('Excel粘贴文本')
      .fill('粘贴费用\t6603\t12.34\t0\n粘贴收入\t6001\t0\t12.34');
    await paste.getByRole('button', { name: '解析预览' }).click();
    await expect(paste).toContainText('1234');
    await paste.getByRole('button', { name: '确认替换分录' }).click();
    await expect(countRows()).toHaveCount(2);
    await page.getByLabel('第2行贷方', { exact: true }).fill('0');
    await page.keyboard.press('=');
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('12.34');
    await expect(page.getByLabel('第2行贷方', { exact: true })).toHaveValue('12.34');
    await page.keyboard.press('F5');
    await expect(page.getByRole('status')).toContainText('已保存 记-0001');
    await page.getByRole('button', { name: '转成模版', exact: true }).click();
    const convert = page.getByRole('dialog', { name: '转成凭证模版' });
    await convert.getByLabel('模版编码').fill('T1');
    await convert.getByLabel('模版名称').fill('日常费用');
    await convert.getByRole('button', { name: '保存模版', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await svc.db
              .withTables<{ voucher_entry_template: { id: number; code: string; name: string } }>()
              .selectFrom('voucher_entry_template')
              .selectAll()
              .execute()
          ).length,
      )
      .toBe(1);
    await page.goto(`${local.url}/m/voucher-entry/templates`);
    await expect(page.getByRole('row').filter({ hasText: '日常费用' })).toBeVisible();
    await page.getByRole('button', { name: '编辑分录与名称', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑凭证模版' });
    await editor.getByLabel('模版编码').fill('T2');
    await editor.getByLabel('模版名称').fill('更新费用');
    await editor.getByLabel('第1行摘要', { exact: true }).fill('模版编辑后的摘要');
    await editor.getByRole('button', { name: '保存模版', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '更新费用' })).toContainText('T2');
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith('voucher-entry.new.')) sessionStorage.removeItem(key);
    });
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('调用前内容');
    await page.getByRole('button', { name: '读入模版', exact: true }).click();
    let picker = page.getByRole('dialog', { name: '读入凭证模版' });
    await select(page, '选择凭证模版', 'T2');
    await picker.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('调用前内容');
    await page.getByRole('button', { name: '读入模版', exact: true }).click();
    picker = page.getByRole('dialog', { name: '读入凭证模版' });
    await picker.getByRole('button', { name: '确认替换当前分录' }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('模版编辑后的摘要');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('已保存 记-0002');
    const applied = (
      await svc.vouchers.list({ summaryContains: '模版编辑后的摘要', statuses: ['pending'] })
    ).items[0]!;
    expect(applied.source).toBeNull();
    expect(applied.auditedBy).toBeNull();
    expect(applied.postedBy).toBeNull();
    await page.goto(`${local.url}/m/voucher-entry/templates`);
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '更新费用' })).toBeVisible();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '更新费用' })).toHaveCount(0);
  } finally {
    await request.dispose();
    await local.close();
  }
});

test('w_pz_pzedit_b：来源只读与来源跳转；隐藏页快捷键不生效；离开可取消、保存或放弃', async ({
  page,
}) => {
  test.setTimeout(60000);
  const local = await fixture();
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    const source = await local.svc(bookId, 'voucher-entry-fixture');
    const created = await seedVouchers(svc, [
      {
        date: '2026-01-10',
        lines: [
          { account: '6603', debit: 100 },
          { account: '6001', credit: 100 },
        ],
      },
    ]);
    const v = await source.vouchers.create({
      voucherTypeId: created[0]!.voucherTypeId,
      date: '2026-01-10',
      source: { type: 'document', id: 'DOC-1' },
      lines: (await svc.vouchers.get(created[0]!.id))!.lines,
    });
    await page.goto(`${local.url}/m/voucher-entry/edit?id=${v.id}`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '查看来源', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry-fixture/documents/DOC-1`);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('离开确认内容');
    await page.getByRole('button', { name: '科目维护', exact: true }).click();
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('离开确认内容');
    await page.getByLabel('第1行摘要', { exact: true }).fill('保存离开内容');
    await page.getByRole('button', { name: '科目维护', exact: true }).click();
    await leave.getByRole('button', { name: '保存缓冲并离开' }).click();
    await expect(page).toHaveURL(`${local.url}/m/accounts`);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存离开内容');
    // 切换到模版页会保留隐藏编辑器；组合键只属于当前可见标签页。
    await page.getByRole('menuitem', { name: '凭证模版', exact: true }).click();
    await expect(page.getByRole('heading', { name: '凭证模版' })).toBeVisible();
    await page.keyboard.press('Control+i');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('F8');
    await page.getByRole('tab', { name: '凭证 记-草稿', exact: true }).click();
    await expect(page.locator('table[aria-label="分录网格"] tbody tr')).toHaveCount(3);
    await page.getByLabel('第1行摘要', { exact: true }).fill('将放弃的新修改');
    await page.keyboard.press('Control+F4');
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: '凭证录入' })).toHaveCount(0);
  } finally {
    await request.dispose();
    await local.close();
  }
});

test('w_pz_pzedit.closequery / u_new：壳关闭按钮与 Ctrl+F4 提供取消/放弃；重输确认不删除已存凭证', async ({
  page,
}) => {
  test.setTimeout(60000);
  const local = await fixture();
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('关闭取消保留');
    await page.getByRole('button', { name: 'remove', exact: true }).click();
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('关闭取消保留');
    await page.getByLabel('第1行摘要', { exact: true }).fill('关闭将放弃');
    await page.keyboard.press('Control+F4');
    await leave.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: '凭证录入' })).toHaveCount(0);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.getByLabel('第1行摘要', { exact: true }).fill('重输之前已存');
    await page.getByRole('button', { name: '保存草稿/缓冲', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('草稿与编辑缓冲已保存');
    const original = (await svc.vouchers.list({ statuses: ['draft'] })).items.at(-1)!;
    await page.getByRole('button', { name: '重新输入', exact: true }).click();
    const reset = page.getByRole('dialog', { name: '重新输入', exact: true });
    await reset.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('重输之前已存');
    expect(await svc.vouchers.get(original.id)).not.toBeNull();
    await page.getByRole('button', { name: '重新输入', exact: true }).click();
    await reset.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('');
    expect(await svc.vouchers.get(original.id)).not.toBeNull();
  } finally {
    await request.dispose();
    await local.close();
  }
});
