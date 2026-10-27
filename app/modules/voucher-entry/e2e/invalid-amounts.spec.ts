import { expect, test, request as requestFactory, type Page } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { voucherInputFromSpec } from '@caiwu/testkit';
import { entryService } from '../server/service';
import type { EntryTables } from '../server/migrations';
import type { SaveInput } from '../shared';
import { fixture } from './fixture';

async function setup(page: Page, local: Awaited<ReturnType<typeof fixture>>) {
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    const service = entryService(svc);
    const data = await voucherInputFromSpec(svc, {
      date: '2026-01-10',
      lines: [
        {
          account: '100202',
          debit: 7100,
          summary: '美元收款',
          currency: 'USD',
          rate: '7.1',
          fcAmount: 1000,
          dims: { cashflow: 'CF01' },
        },
        { account: '6001', credit: 7100, summary: '收入' },
      ],
    });
    const key = 'invalid-amount-regression';
    const draft = await service.save({ key, bufferRevision: 0, data: { ...data, draft: true } });
    await page.addInitScript(
      ({ bookId, key }) => sessionStorage.setItem(`voucher-entry.new.${bookId}`, key),
      { bookId, key },
    );
    const calls: SaveInput[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/trpc/m.voucher-entry.save?'))
        calls.push(Object.values(request.postDataJSON() as Record<string, SaveInput>)[0]!);
    });
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await page.clock.install();
    const buffer = () =>
      svc.db
        .withTables<EntryTables>()
        .selectFrom('voucher_entry_buffer')
        .selectAll()
        .where('client_key', '=', key)
        .executeTakeFirstOrThrow();
    return { svc, service, data, draft, calls, buffer };
  } finally {
    await request.dispose();
  }
}
async function dirty(page: Page) {
  return page.evaluate(
    () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
  );
}

for (const label of ['第1行借方', '第2行贷方']) {
  test(`w_pz_pzedit：${label}非法文本失焦保留，手动和自动保存不提交旧值，修正后正常保存`, async ({
    page,
  }) => {
    const local = await fixture();
    try {
      const { svc, draft, calls, buffer } = await setup(page, local);
      const before = await buffer();
      const input = page.getByLabel(label, { exact: true });
      await input.fill('1.2.3');
      await page.getByLabel('第1行摘要', { exact: true }).focus();
      await expect(input).toHaveValue('1.2.3');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(await dirty(page)).toBe(true);
      await page.clock.runFor(1000);
      await expect(page.getByRole('status')).toContainText('金额格式有误');
      await page.getByRole('button', { name: '保存草稿/缓冲', exact: true }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: '请改为数字金额' })).toBeVisible();
      expect(calls).toHaveLength(0);
      expect(await buffer()).toEqual(before);
      expect((await svc.vouchers.get(draft.voucher!.id))!.revision).toBe(draft.voucher!.revision);
      await page.getByLabel('第1行摘要', { exact: true }).focus();
      await input.click();
      // 再次进入非法金额也全选；直接输入即可纠正。
      await page.keyboard.type('71');
      await expect(input).toHaveValue('71');
      await page.keyboard.press('F5');
      await expect(page.getByRole('status')).toContainText('已保存 记-0001');
      expect(calls).toHaveLength(1);
      expect(await svc.vouchers.get(draft.voucher!.id)).toMatchObject({
        status: 'pending',
        debitTotal: 7100,
        creditTotal: 7100,
      });
      expect(await dirty(page)).toBe(false);
    } finally {
      await local.close();
    }
  });
}

test('w_pz_flxx1：非法原币抽屉关闭重开、前方插删行仍保留，隐藏抽屉的原币也阻止保存', async ({
  page,
}) => {
  const local = await fixture();
  try {
    const { calls, buffer } = await setup(page, local);
    const before = await buffer();
    await page.getByLabel('第1行借方', { exact: true }).focus();
    await page.keyboard.press('F6');
    let detail = page.getByRole('dialog', { name: '第1行分录信息', exact: true });
    await detail.getByLabel('第1行原币金额', { exact: true }).fill('原币错文');
    await page.keyboard.press('Escape');
    await expect(detail).not.toBeVisible();
    await page.clock.runFor(1000);
    expect(calls).toHaveLength(0);
    await page.getByRole('button', { name: '保存草稿/缓冲', exact: true }).click();
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel('第1行原币金额', { exact: true })).toHaveValue('原币错文');
    await page.keyboard.press('Escape');
    await page.getByLabel('第1行借方', { exact: true }).focus();
    await page.keyboard.press('Control+i');
    // 第二行的非法贷方随原行向后移动，删除空行后回到原行。
    await page.getByLabel('第3行贷方', { exact: true }).fill('贷方错文');
    await page.getByLabel('第2行摘要', { exact: true }).focus();
    await page.keyboard.press('Control+d');
    await expect(page.getByLabel('第2行贷方', { exact: true })).toHaveValue('贷方错文');
    await page.getByLabel('第1行借方', { exact: true }).focus();
    await page.keyboard.press('F6');
    detail = page.getByRole('dialog', { name: '第1行分录信息', exact: true });
    await expect(detail.getByLabel('第1行原币金额', { exact: true })).toHaveValue('原币错文');
    expect(await buffer()).toEqual(before);
    expect(calls).toHaveLength(0);
    await detail.getByLabel('第1行原币金额', { exact: true }).fill('10');
    await page.keyboard.press('Escape');
    await page.getByLabel('第2行贷方', { exact: true }).fill('71');
    await page.getByRole('button', { name: '保存草稿/缓冲', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('草稿与编辑缓冲已保存');
    expect(calls).toHaveLength(1);
  } finally {
    await local.close();
  }
});

test('w_pz_pzedit.closequery：非法文本关闭标签可取消，保存失败仍dirty，明确放弃恢复已存内容', async ({
  page,
}) => {
  const local = await fixture();
  try {
    const { calls, buffer } = await setup(page, local);
    const before = await buffer();
    await page.getByLabel('第1行借方', { exact: true }).fill('坏金额');
    await page.getByRole('button', { name: 'remove', exact: true }).click();
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('坏金额');
    await page.keyboard.press('Control+F4');
    await leave.getByRole('button', { name: '保存缓冲并离开', exact: true }).click();
    await expect(leave).toBeVisible();
    expect(await dirty(page)).toBe(true);
    expect(calls).toHaveLength(0);
    await leave.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: '凭证录入', exact: true })).toHaveCount(0);
    expect(await buffer()).toEqual(before);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('71.00');
    expect(await dirty(page)).toBe(false);
  } finally {
    await local.close();
  }
});

test('w_pz_pzedit.closequery / w_main1：切账与关闭所有识别纯非法文本，取消/保存失败不离开，放弃才继续', async ({
  page,
}) => {
  const local = await fixture();
  try {
    const { calls, buffer } = await setup(page, local);
    const before = await buffer();
    await page.getByLabel('第1行借方', { exact: true }).fill('坏金额');
    await page.getByRole('button', { name: '关闭所有', exact: true }).click();
    let guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '保存并继续', exact: true }).click();
    await expect(guard).not.toBeVisible();
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('坏金额');
    expect(await dirty(page)).toBe(true);
    await page.getByRole('button', { name: /系统管理员/ }).hover();
    await page
      .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
      .getByRole('menuitem', { name: '切换账套', exact: true })
      .click();
    // 模块先处理鼠标离开确认；保存不能将非法文本悄悄换成旧值。
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('坏金额');
    await page.getByRole('button', { name: /系统管理员/ }).hover();
    await page
      .locator('.ant-dropdown:not(.ant-dropdown-hidden)')
      .getByRole('menuitem', { name: '切换账套', exact: true })
      .click();
    await leave.getByRole('button', { name: '放弃修改', exact: true }).click();
    guard = page.getByRole('dialog', { name: '有未保存内容', exact: true });
    await expect(guard).not.toBeVisible();
    await expect(page).toHaveURL(`${local.url}/`);
    expect(calls).toHaveLength(0);
    expect(await buffer()).toEqual(before);
  } finally {
    await local.close();
  }
});

test('w_pz_pzedit_b：保存响应等待期间输入非法文本，旧响应和排队自动保存不能清dirty或离开', async ({
  page,
}) => {
  const local = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let processed!: () => void;
  const saved = new Promise<void>((resolve) => (processed = resolve));
  await page.route('**/trpc/m.voucher-entry.save*', async (route) => {
    const response = await route.fetch();
    processed();
    await gate;
    await route.fulfill({ response });
  });
  try {
    const { calls, svc, draft } = await setup(page, local);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await saved;
    await page.getByLabel('第1行借方', { exact: true }).fill('保存中坏金额');
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: '科目维护', exact: true }).click();
    release();
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容', exact: true });
    await expect(leave).toBeVisible();
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('保存中坏金额');
    expect(calls).toHaveLength(1);
    expect((await svc.vouchers.get(draft.voucher!.id))!.debitTotal).toBe(7100);
    expect(await dirty(page)).toBe(true);
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByLabel('第1行借方', { exact: true }).fill('71');
    await page.getByRole('button', { name: '保存草稿/缓冲', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('编辑缓冲已保存');
    expect(await dirty(page)).toBe(false);
    expect(calls).toHaveLength(2);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await local.close();
  }
});

test('w_pz_pzedit_mb：模板非法金额不保存旧值，计算器取消保留原文，明确回填后正常保存', async ({
  page,
}) => {
  const local = await fixture();
  try {
    const { service, data } = await setup(page, local);
    const id = await service.saveTemplate({
      code: 'INV',
      name: '非法金额回归',
      voucherTypeId: data.voucherTypeId,
      lines: data.lines,
    });
    const before = await service.template(id);
    await page.goto(`${local.url}/m/voucher-entry/templates`);
    await page.getByRole('button', { name: '编辑分录与名称', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑凭证模版', exact: true });
    const input = editor.getByLabel('第1行借方', { exact: true });
    await input.fill('模板坏金额');
    await page.keyboard.press('F5');
    await expect(editor).toContainText('请改为数字金额');
    expect((await service.template(id)).revision).toBe(before.revision);
    expect(await dirty(page)).toBe(true);
    await input.focus();
    await page.keyboard.press('F9');
    const calculator = page.getByRole('dialog', { name: '简易计算器（F9）', exact: true });
    await calculator.getByRole('button', { name: '返回', exact: true }).click();
    await expect(input).toHaveValue('模板坏金额');
    await expect(input).toBeFocused();
    await page.keyboard.press('F9');
    await calculator.getByLabel('计算器算式', { exact: true }).fill('71');
    await page.keyboard.press('Enter');
    await calculator.getByRole('button', { name: '填入第1行借方', exact: true }).click();
    await expect(input).toHaveValue('71.00');
    await expect(input).toBeFocused();
    await page.keyboard.press('F5');
    await expect(editor).not.toBeVisible();
    expect((await service.template(id)).revision).toBe(before.revision + 1);
    expect(await dirty(page)).toBe(false);
  } finally {
    await local.close();
  }
});
