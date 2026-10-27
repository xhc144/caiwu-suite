import { expect, test } from '@playwright/test';
import { seedVouchers } from '@caiwu/testkit';
import { browserRuntime } from './runtime';

for (const immediateSecond of [false, true]) {
  test(`w_pz_pzxsb 导航与输入受控交错：${immediateSecond ? '同任务快速两次查询' : '首次提交后继续编辑再查询'}`, async ({
    page,
  }) => {
    const t = await browserRuntime();
    try {
      await seedVouchers(
        t.app.svc,
        ['交错第一', '交错第二'].map((summary) => ({
          date: '2026-01-05',
          summary,
          lines: [
            { account: '6603', debit: 1 },
            { account: '1001', credit: 1 },
          ],
        })),
      );
      await t.login(page, 'admin', 'admin');
      const summary = page.getByLabel('摘要', { exact: true });
      await summary.fill('交错第一');
      const identity = await summary.evaluateHandle((input) => input.closest('form'));
      const requests: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('voucher-book.list')) requests.push(decodeURIComponent(req.url()));
      });
      // 在真实history调用内输入，精确落在第一次地址更新后、Router提交前；不等待迟到提交。
      await page.evaluate((submitSecond) => {
        const push = history.pushState.bind(history);
        const records: { kind: string; url?: string; value?: string }[] = [];
        Object.assign(window, { m06Records: records });
        history.pushState = (data, unused, url) => {
          records.push({ kind: 'pushState', url: String(url) });
          push(data, unused, url);
          if (records.length === 1) {
            const input = document.querySelector<HTMLInputElement>('[data-voucher-summary]')!;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              input,
              '交错第二',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
            records.push({ kind: 'input-before-router-commit', value: input.value });
            if (submitSecond)
              input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        };
      }, immediateSecond);
      await page.getByRole('button', { name: '查询', exact: true }).click();
      if (!immediateSecond) {
        await expect(page.getByRole('row').filter({ hasText: '交错第一' })).toBeVisible();
        await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '交错第一');
        await expect(page.getByText('筛选条件已修改，尚未查询', { exact: true })).toBeVisible();
        await expect(page.getByText(/已应用摘要：交错第一/)).toBeVisible();
        await page.getByRole('button', { name: '查询', exact: true }).click();
      }
      await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '交错第二');
      await expect(page.getByRole('row').filter({ hasText: '交错第二' })).toBeVisible();
      await expect(page.getByRole('row').filter({ hasText: '交错第一' })).toHaveCount(0);
      await expect(summary).toHaveValue('交错第二');
      await expect(page.getByText('筛选条件已修改，尚未查询', { exact: true })).toHaveCount(0);
      const sameForm = await page.evaluate(
        (form) => form === document.querySelector('[data-voucher-summary]')?.closest('form'),
        identity,
      );
      expect(sameForm).toBe(true);
      expect(requests.some((url) => url.includes('"summaryContains":"交错第二"'))).toBe(true);
      const historyRecords = await page.evaluate(() => Reflect.get(window, 'm06Records'));
      console.log(JSON.stringify({ immediateSecond, sameForm, history: historyRecords, requests }));
      await identity.dispose();
    } finally {
      await t.close();
    }
  });
}

test('w_pz_pzxsb 旧查询响应晚到不能覆盖新查询，真实API、URL、结果保持一致', async ({ page }) => {
  const t = await browserRuntime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetched!: () => void;
  const firstFetched = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  let fulfilled!: () => void;
  const firstFulfilled = new Promise<void>((resolve) => {
    fulfilled = resolve;
  });
  try {
    await seedVouchers(
      t.app.svc,
      ['迟到第一', '迟到第二'].map((summary) => ({
        date: '2026-01-05',
        summary,
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      })),
    );
    await t.login(page, 'admin', 'admin');
    await page.route('**/trpc/**', async (route) => {
      const url = decodeURIComponent(route.request().url());
      if (!url.includes('voucher-book.list') || !url.includes('"summaryContains":"迟到第一"'))
        return route.continue();
      const response = await route.fetch();
      fetched();
      await gate;
      await route.fulfill({ response });
      fulfilled();
    });
    const summary = page.getByLabel('摘要', { exact: true });
    await summary.fill('迟到第一');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await firstFetched;
    await summary.fill('迟到第二');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '迟到第二' })).toBeVisible();
    release();
    await firstFulfilled;
    await expect(page).toHaveURL((url) => url.searchParams.get('summary') === '迟到第二');
    await expect(summary).toHaveValue('迟到第二');
    await expect(page.getByRole('row').filter({ hasText: '迟到第二' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '迟到第一' })).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await t.close();
  }
});

test('w_pz_pzxsb 外部URL、历史提交重放与重置同步字段，Form保持身份', async ({ page }) => {
  const t = await browserRuntime();
  try {
    await seedVouchers(
      t.app.svc,
      ['历史第一', '历史第二'].map((summary) => ({
        date: '2026-01-05',
        summary,
        lines: [
          { account: '6603', debit: 1 },
          { account: '1001', credit: 1 },
        ],
      })),
    );
    await t.login(page, 'admin', 'admin');
    const summary = page.getByLabel('摘要', { exact: true });
    const identity = await summary.evaluateHandle((input) => input.closest('form'));
    for (const value of ['历史第一', '历史第二']) {
      await summary.fill(value);
      await page.getByRole('button', { name: '查询', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: value })).toBeVisible();
    }
    await summary.fill('尚未提交');
    await page.goBack();
    await expect(summary).toHaveValue('历史第一');
    await expect(page.getByRole('row').filter({ hasText: '历史第一' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '历史第二' })).toHaveCount(0);
    await page.goForward();
    await expect(summary).toHaveValue('历史第二');
    await expect(page.getByRole('row').filter({ hasText: '历史第二' })).toBeVisible();
    await summary.fill('外部导航前未提交');
    await page.evaluate(() => {
      history.pushState(
        { ...history.state, key: 'm06-external', usr: null },
        '',
        '/m/voucher-book?summary=历史第一&amountFrom=1&voided=1',
      );
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    });
    await expect(summary).toHaveValue('历史第一');
    await expect(page.getByLabel('金额起（元）', { exact: true })).toHaveValue('0.01');
    await expect(page.getByRole('checkbox', { name: '含作废', exact: true })).toBeChecked();
    await expect(page.getByRole('row').filter({ hasText: '历史第一' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '历史第二' })).toHaveCount(0);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    await expect(summary).toHaveValue('');
    await expect(page.getByLabel('金额起（元）', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: '含作废', exact: true })).not.toBeChecked();
    await expect(page).toHaveURL(
      (url) => !url.searchParams.has('summary') && !url.searchParams.has('amountFrom'),
    );
    await expect(page.getByRole('row').filter({ hasText: '历史第一' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '历史第二' })).toBeVisible();
    expect(
      await page.evaluate(
        (form) => form === document.querySelector('[data-voucher-summary]')?.closest('form'),
        identity,
      ),
    ).toBe(true);
    await identity.dispose();
  } finally {
    await t.close();
  }
});

test('w_pz_pzxsb / w_pz_zhcx：金额按元输入，旧分值链接和综合条件刷新往返，制单人按名称查询历史停用账号', async ({
  page,
}) => {
  const t = await browserRuntime();
  try {
    const user = await t.app.svc.users.create({
      code: 'history-maker',
      name: '历史制单人',
      password: 'example-only',
    });
    // 独立账套前置通过公开凭证入口建立，没有修改核心凭证表。
    const actor = await import('@caiwu/core/server');
    const svc = actor.createCoreServices({
      db: t.app.svc.db,
      user: (await actor.loadServiceUser(t.app.svc.db, user.id))!,
      moduleId: null,
      now: t.app.runtime.now,
      modules: t.app.runtime.modules.lookup,
    });
    await seedVouchers(svc, [
      {
        date: '2026-01-05',
        summary: '元金额负数',
        lines: [
          { account: '6603', debit: -1 },
          { account: '6001', credit: -1 },
        ],
      },
    ]);
    await t.app.svc.db
      .updateTable('app_user')
      .set({ disabled: 1 })
      .where('id', '=', user.id)
      .execute();
    await t.login(page, 'admin', 'admin');
    await page.goto(`${t.address}/m/voucher-book?amountFrom=-1&amountTo=-1`);
    await expect(page.getByLabel('金额起（元）', { exact: true })).toHaveValue('-0.01');
    await expect(page.getByRole('row').filter({ hasText: '元金额负数' })).toBeVisible();
    const creator = page.getByRole('combobox', { name: '制单人', exact: true });
    await creator.fill('历史制单人');
    await expect(
      page.locator('.ant-select-item-option-content').filter({ hasText: 'history-maker，已停用' }),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('creator') === String(user.id) &&
        url.searchParams.get('amountFrom') === '-1',
    );
    await page.reload();
    await expect(page.getByLabel('金额止（元）', { exact: true })).toHaveValue('-0.01');
    await expect(page.getByRole('row').filter({ hasText: '元金额负数' })).toBeVisible();
    await page.getByRole('button', { name: '添加查询条件', exact: true }).click();
    await page.getByLabel('综合查询字段1', { exact: true }).click();
    await page.locator('.ant-select-item-option-content').filter({ hasText: '金额（元）' }).click();
    await page.getByLabel('综合查询操作1', { exact: true }).click();
    await page
      .locator('.ant-select-item-option-content')
      .filter({ hasText: /^等于$/ })
      .click();
    await page.getByLabel('综合查询值1', { exact: true }).fill('-0.01');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page).toHaveURL(
      (url) => JSON.parse(url.searchParams.get('conditions') ?? '[]')[0]?.value === '-1',
    );
    await page.reload();
    await expect(page.getByLabel('综合查询值1', { exact: true })).toHaveValue('-0.01');
    await expect(page.getByRole('row').filter({ hasText: '元金额负数' })).toBeVisible();
    await page.getByLabel('金额起（元）', { exact: true }).fill('90071992547409.92');
    const before = page.url();
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByText('金额超出可查询范围，请缩小金额', { exact: true })).toBeVisible();
    expect(page.url()).toBe(before);
  } finally {
    await t.close();
  }
});
