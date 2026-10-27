import { expect, test, request as requestFactory, type Page } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import { entryService } from '../server/service';
import type { TemplateInput } from '../shared';
import { fixture } from './fixture';

async function select(page: Page, label: string, code: string) {
  await page.getByRole('combobox', { name: label, exact: true }).fill(code);
  await page.keyboard.press('Enter');
}
async function setup(page: Page, local: Awaited<ReturnType<typeof fixture>>) {
  const request = await requestFactory.newContext({ baseURL: local.url });
  const { bookId } = await loginWithNewBook(page, request, { seed: false });
  const svc = await local.seed(bookId);
  const data = await voucherInputFromSpec(svc, {
    date: '2026-01-10',
    lines: [
      { account: '6603', debit: 7100 },
      { account: '6001', credit: 7100 },
    ],
  });
  return {
    request,
    svc,
    service: entryService(svc),
    template: {
      code: 'W2',
      name: '键盘模版',
      voucherTypeId: data.voucherTypeId,
      lines: data.lines,
    },
  };
}

test('w_pz_pzedit_mb：Enter/F4/F6/插删行/F5真实保存；输入法组合键不插行，重输取消保留', async ({
  page,
}) => {
  const local = await fixture();
  const { request, service, template } = await setup(page, local);
  try {
    const id = await service.saveTemplate(template);
    await page.goto(`${local.url}/m/voucher-entry/templates`);
    await page.getByRole('button', { name: '编辑分录与名称', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑凭证模版', exact: true });
    const rows = editor.locator('tbody [data-line]');
    await expect(rows).toHaveCount(2);
    await editor.getByLabel('第1行摘要', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(editor.getByRole('combobox', { name: '第1行科目', exact: true })).toBeFocused();
    await editor.getByLabel('第1行摘要', { exact: true }).focus();
    await page.keyboard.press('F4');
    await expect(editor.getByRole('combobox', { name: '第1行科目', exact: true })).toBeFocused();
    await page.evaluate(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, isComposing: true, bubbles: true }),
      ),
    );
    await expect(rows).toHaveCount(2);
    await page.keyboard.press('Control+i');
    await expect(rows).toHaveCount(3);
    await expect(editor.getByLabel('第2行摘要', { exact: true })).toBeFocused();
    await page.keyboard.press('Control+d');
    await expect(rows).toHaveCount(2);
    await page.keyboard.press('F6');
    const detail = page.getByRole('dialog', { name: '第2行模版分录信息', exact: true });
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).not.toBeVisible();
    await expect(editor).toBeVisible();
    await editor.getByLabel('第1行摘要', { exact: true }).fill('键盘编辑已保存');
    await editor.getByRole('button', { name: '重新输入分录', exact: true }).click();
    await page
      .getByRole('dialog', { name: '重新输入模版分录', exact: true })
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await expect(editor.getByLabel('第1行摘要', { exact: true })).toHaveValue('键盘编辑已保存');
    await page.keyboard.press('F5');
    await expect(editor).not.toBeVisible();
    expect((await service.template(id)).lines[0]?.summary).toBe('键盘编辑已保存');
  } finally {
    await request.dispose();
    await local.close();
  }
});

for (const existing of [false, true]) {
  test(`w_pz_pzmb_main：${existing ? '修改' : '新增'}保存响应延迟时保留新输入，新revision再保存且不重复创建`, async ({
    page,
  }) => {
    const local = await fixture();
    const { request, service, template } = await setup(page, local);
    let release!: () => void;
    let processed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saved = new Promise<void>((resolve) => {
      processed = resolve;
    });
    const calls: TemplateInput[] = [];
    await page.route('**/trpc/m.voucher-entry.saveTemplate*', async (route) => {
      calls.push(
        Object.values(route.request().postDataJSON() as Record<string, TemplateInput>)[0]!,
      );
      const response = await route.fetch();
      if (calls.length === 1) {
        processed();
        await gate;
      }
      await route.fulfill({ response });
    });
    try {
      if (existing) await service.saveTemplate(template);
      await page.goto(`${local.url}/m/voucher-entry/templates`);
      await page
        .getByRole('button', { name: existing ? '编辑分录与名称' : '新增模版', exact: true })
        .click();
      const editor = page.getByRole('dialog', { name: /^(编辑|新增)凭证模版$/ });
      if (!existing) {
        await editor.getByLabel('模版编码', { exact: true }).fill('W2');
        await editor.getByLabel('第1行摘要', { exact: true }).fill('费用');
        await select(page, '第1行科目', '6603');
        await editor.getByLabel('第1行借方', { exact: true }).fill('71');
        await editor.getByLabel('第2行摘要', { exact: true }).fill('收入');
        await select(page, '第2行科目', '6001');
        await editor.getByLabel('第2行贷方', { exact: true }).fill('71');
      }
      await editor.getByLabel('模版名称', { exact: true }).fill('请求中的旧名称');
      await page.keyboard.press('Control+s');
      await saved;
      await editor.getByLabel('模版名称', { exact: true }).fill('响应前的新名称');
      await editor.getByLabel('第1行摘要', { exact: true }).fill('响应前的新分录');
      await page.keyboard.press('Control+s');
      release();
      await expect(editor).toBeVisible();
      await expect(editor).toContainText('上一版模版已保存，当前新修改尚未保存');
      await expect(editor.getByLabel('模版名称', { exact: true })).toHaveValue('响应前的新名称');
      const first = (await service.templates())[0]!;
      expect(first.name).toBe('请求中的旧名称');
      expect(calls).toHaveLength(1);
      await page.keyboard.press('F5');
      await expect(editor).not.toBeVisible();
      const final = await service.template(first.id);
      expect(final.name).toBe('响应前的新名称');
      expect(final.lines[0]?.summary).toBe('响应前的新分录');
      expect(final.revision).toBe(existing ? 3 : 2);
      expect(await service.templates()).toHaveLength(1);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ id: first.id, revision: existing ? 2 : 1 });
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await request.dispose();
      await local.close();
    }
  });
}

test('w_pz_pzedit_b / w_pz_flxx1：逐字改月不沿用旧汇率，带入期间汇率重算红字并按当前辅助组合查询', async ({
  page,
}) => {
  const local = await fixture();
  const { request, svc } = await setup(page, local);
  try {
    await svc.db
      .insertInto('exchange_rate')
      .values({ currency_code: 'USD', period: 202602, rate: '7.2' })
      .execute();
    const [v] = await seedVouchers(svc, [
      {
        date: '2026-01-10',
        lines: [
          {
            account: '100202',
            debit: -7100,
            currency: 'USD',
            rate: '7.1',
            fcAmount: -1000,
            dims: { cashflow: 'CF01' },
          },
          { account: '6001', credit: -7100 },
        ],
      },
    ]);
    await page.goto(`${local.url}/m/voucher-entry/edit?id=${v!.id}`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await expect(page.locator('[data-line="0"]')).toContainText('当前辅助组合');
    await expect(page.locator('[data-line="0"]')).toContainText('原币 USD -10.00');
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-0');
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-10');
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('-72.00');
    await page.getByLabel('第1行借方', { exact: true }).focus();
    await page.keyboard.press('F6');
    const details = page.getByRole('dialog', { name: '第1行分录信息', exact: true });
    await expect(details.getByLabel('第1行汇率', { exact: true })).toHaveValue('7.2');
    await details.getByLabel('第1行汇率', { exact: true }).fill('7.3');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('-73.00');
    await page.getByRole('button', { name: '带入期间汇率 7.2', exact: true }).click();
    await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('-72.00');
    expect((await svc.vouchers.get(v!.id))!.lines[0]).toMatchObject({
      debit: -7100,
      exchangeRate: '7.1',
    });
  } finally {
    await request.dispose();
    await local.close();
  }
});

test('w_pz_pzedit_b：首上下一末稳定移动，保存响应延迟不覆盖新编辑，取消/保存缓冲离开后精确恢复', async ({
  page,
}) => {
  const local = await fixture();
  const { request, svc, service } = await setup(page, local);
  let release!: () => void;
  let processed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    processed = resolve;
  });
  let held = false;
  await page.route('**/trpc/m.voucher-entry.save*', async (route) => {
    const response = await route.fetch();
    if (!held) {
      held = true;
      processed();
      await gate;
    }
    await route.fulfill({ response });
  });
  try {
    const input = await voucherInputFromSpec(svc, {
      date: '2026-01-10',
      lines: [
        { account: '6603', debit: 100 },
        { account: '6001', credit: 100 },
      ],
    });
    const a = await svc.vouchers.create({ ...input, number: 3 });
    const b = await svc.vouchers.create({ ...input, number: 1 });
    const c = await svc.vouchers.create({ ...input, date: '2026-02-10' });
    await svc.vouchers.changeStatus({ ids: [c.id], to: 'audited' });
    await page.goto(`${local.url}/m/voucher-entry/edit?id=${b.id}`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await expect(page.getByRole('button', { name: '首张', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '上一张', exact: true })).toBeDisabled();
    await page.clock.install();
    await page.getByLabel('第1行摘要', { exact: true }).fill('正式提交的版本');
    await page.keyboard.press('Control+s');
    await saved;
    await page.getByLabel('第1行摘要', { exact: true }).fill('保存期间继续输入');
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${b.id}`);
    release();
    const leave = page.getByRole('dialog', { name: '尚有未持久化内容', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存期间继续输入');
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await leave.getByRole('button', { name: '保存缓冲并离开', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${a.id}`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    expect((await svc.vouchers.get(b.id))!.lines[0]?.summary).toBe('正式提交的版本');
    expect((await service.buffer(`edit-${b.id}`))!.data.lines[0]?.summary).toBe('保存期间继续输入');
    await page.getByRole('button', { name: '上一张', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${b.id}`);
    // 正式凭证的未提交缓冲按现有契约显式恢复；不能把缓冲当作正式记录。
    await expect(page.getByRole('status')).toContainText('存在未提交编辑缓冲');
    await page.getByRole('button', { name: '恢复编辑缓冲', exact: true }).click();
    await page
      .getByRole('dialog', { name: '恢复编辑缓冲', exact: true })
      .getByRole('button', { name: '确认', exact: true })
      .click();
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存期间继续输入');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('status')).toContainText('已保存 记-0001');
    expect((await svc.vouchers.get(b.id))!.lines[0]?.summary).toBe('保存期间继续输入');
    await page.getByRole('button', { name: '末张', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${c.id}`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '下一张', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '末张', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '首张', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/edit?id=${b.id}`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存期间继续输入');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await request.dispose();
    await local.close();
  }
});

for (const templateMode of [false, true]) {
  test(`w_calc：${templateMode ? '模版' : '凭证'}F9四则结果填入当前金额并真实保存，除零不改分录`, async ({
    page,
  }) => {
    const local = await fixture();
    const { request, svc, service, template } = await setup(page, local);
    try {
      const id = templateMode
        ? await service.saveTemplate(template)
        : (
            await svc.vouchers.create(
              await voucherInputFromSpec(svc, {
                date: '2026-01-10',
                lines: [
                  { account: '6603', debit: 7100 },
                  { account: '6001', credit: 7100 },
                ],
              }),
            )
          ).id;
      await page.goto(
        `${local.url}/m/voucher-entry/${templateMode ? 'templates' : `edit?id=${id}`}`,
      );
      if (templateMode)
        await page.getByRole('button', { name: '编辑分录与名称', exact: true }).click();
      else await expect(page.getByRole('status')).toContainText('已恢复');
      await page.getByLabel('第1行借方', { exact: true }).focus();
      await page.keyboard.press('F9');
      const calc = page.getByRole('dialog', { name: '简易计算器（F9）', exact: true });
      await expect(calc).toBeVisible();
      await calc.getByLabel('计算器算式', { exact: true }).fill('1/0');
      await page.keyboard.press('Enter');
      await expect(calc.getByRole('alert')).toContainText('除数为零');
      await expect(calc.getByRole('button', { name: '填入第1行借方', exact: true })).toBeDisabled();
      await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('71.00');
      await calc.getByLabel('计算器算式', { exact: true }).fill('(0.1 + 0.2) * 10');
      await page.keyboard.press('Enter');
      await expect(calc.getByRole('status')).toContainText('3.00');
      await calc.getByRole('button', { name: '填入第1行借方', exact: true }).click();
      await expect(page.getByLabel('第1行借方', { exact: true })).toHaveValue('3.00');
      await page.getByLabel('第2行贷方', { exact: true }).fill('3');
      await page.keyboard.press('Control+s');
      if (templateMode) {
        await expect(
          page.getByRole('dialog', { name: '编辑凭证模版', exact: true }),
        ).not.toBeVisible();
        expect((await service.template(id)).lines.map((line) => [line.debit, line.credit])).toEqual(
          [
            [300, 0],
            [0, 300],
          ],
        );
      } else {
        await expect(page.getByRole('status')).toContainText('已保存 记-0001');
        expect(
          (await svc.vouchers.get(id))!.lines.map((line) => [line.debit, line.credit]),
        ).toEqual([
          [300, 0],
          [0, 300],
        ]);
      }
    } finally {
      await request.dispose();
      await local.close();
    }
  });
}

test('w_calc / w_pz_pzedit_mb：入场时F9后直接键盘计算，重复Enter、重新开启和取消不改金额', async ({
  page,
}) => {
  const local = await fixture();
  const { request, service, template } = await setup(page, local);
  try {
    const id = await service.saveTemplate(template);
    await page.goto(`${local.url}/m/voucher-entry/templates`);
    await page.getByRole('button', { name: '编辑分录与名称', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑凭证模版', exact: true });
    const debit = editor.getByLabel('第1行借方', { exact: true });
    const calc = page.getByRole('dialog', { name: '简易计算器（F9）', exact: true });
    const expression = calc.getByLabel('计算器算式', { exact: true });
    await debit.focus();
    await page.keyboard.press('F9');
    await expect(expression).toBeFocused();
    await page.keyboard.type('(0.1 + 0.2) * 10');
    // 等父层的真实入场结束，确认 Enter 仍发往算式，而非被重聚焦的关闭按钮。
    await expect.poll(() => editor.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect(expression).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(calc.getByRole('status')).toContainText('3.00');
    await page.keyboard.press('Enter');
    await expect(calc.getByRole('status')).toContainText('3.00');
    await expect(debit).toHaveValue('71.00');
    await calc.getByRole('button', { name: '填入第1行借方', exact: true }).click();
    await expect(debit).toHaveValue('3.00');
    await expect(debit).toBeFocused();

    await page.keyboard.press('F9');
    await expect(expression).toBeFocused();
    await expect(expression).toHaveValue('');
    await page.keyboard.type('1/0');
    await page.keyboard.press('Enter');
    await expect(calc.getByRole('alert')).toContainText('除数为零');
    await page.keyboard.press('Escape');
    await expect(calc).not.toBeVisible();
    await expect(editor).toBeVisible();
    await expect(debit).toHaveValue('3.00');

    await debit.focus();
    await page.keyboard.press('F9');
    await expect(expression).toBeFocused();
    await expect(expression).toHaveValue('');
    await page.keyboard.type('-1.005');
    await page.keyboard.press('Enter');
    await expect(calc.getByRole('status')).toContainText('-1.01');
    await calc.getByRole('button', { name: '填入第1行借方', exact: true }).click();
    await expect(debit).toHaveValue('-1.01');
    await editor.getByLabel('第2行贷方', { exact: true }).fill('-1.01');
    await page.keyboard.press('Control+s');
    await expect(editor).not.toBeVisible();
    expect((await service.template(id)).lines.map((line) => [line.debit, line.credit])).toEqual([
      [-101, 0],
      [0, -101],
    ]);
    expect(await service.templates()).toHaveLength(1);
  } finally {
    await request.dispose();
    await local.close();
  }
});
