import { expect, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { emptyTemplate, type Report } from '../shared';
import { test } from './fixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** 真正调用本地保存接口，只延迟其原始响应；不替换业务数据或余额。 */
async function holdSaveResponse(page: Page) {
  const received = deferred(),
    release = deferred();
  let calls = 0;
  await page.route(
    (url) =>
      url.pathname.startsWith('/trpc/') &&
      url.pathname.slice(6).split(',').includes('m.report-engine.save'),
    async (route) => {
      calls += new URL(route.request().url()).pathname
        .slice(6)
        .split(',')
        .filter((name) => name === 'm.report-engine.save').length;
      const response = await route.fetch();
      received.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
  );
  return {
    received: received.promise,
    calls: () => calls,
    async finish() {
      release.resolve();
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}

function textTemplate(code: string, name: string, text: string) {
  const template = emptyTemplate({ code, name, rows: 3, cols: 3 });
  template.cells = [{ address: 'A1', kind: 'text', source: text, unit: 'number', currency: 'CNY' }];
  return template;
}

async function localDraft(page: Page, bookId: string, reportId: number) {
  return page.evaluate(
    ({ bookId, reportId }) => {
      const key = Object.keys(sessionStorage).find(
        (key) => key.startsWith(`report-engine.draft.${bookId}.`) && key.endsWith(`.${reportId}`),
      );
      return key
        ? (JSON.parse(sessionStorage.getItem(key)!) as { template: Report['template'] })
        : null;
    },
    { bookId, reportId },
  );
}

test('w_bb_def 延迟保存响应冻结所有定义入口，重复保存不并发，完成后切表不串稿', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    textTemplate('101', '保存竞态', '原文'),
    { token, method: 'POST' },
  );
  const other = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    textTemplate('102', '另一报表', '另一报表原文'),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  const cell = page.getByRole('textbox', { name: 'A1', exact: true });
  await cell.fill('第一次编辑');
  await page.getByRole('button', { name: '审核公式', exact: true }).click();
  const checks = page.getByRole('dialog', { name: '审核公式（勾稽）' });
  await checks.getByRole('button', { name: '增加审核项', exact: true }).click();
  const delayed = await holdSaveResponse(page);
  try {
    await page.keyboard.press('Control+s');
    await delayed.received;
    const server = await callApi<Report>(
      isolated.request,
      'm.report-engine.get',
      { id: report.id },
      { token },
    );
    expect(server.template.cells[0]!.source).toBe('第一次编辑');
    expect(server.revision).toBe(2);
    await expect(cell).not.toBeEditable();
    for (const input of await checks.getByRole('textbox').all()) await expect(input).toBeDisabled();
    await expect(checks.getByRole('button', { name: '增加审核项', exact: true })).toBeDisabled();
    await expect(checks.getByRole('button', { name: '移除此审核项', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(checks).not.toBeVisible();
    await cell.focus();
    await page.keyboard.type('等待期间的后续输入');
    await expect(cell).toHaveValue('第一次编辑');
    for (const label of [
      '定义编码',
      '定义名称',
      '定义行数',
      '定义列数',
      '当前单元格内容',
      '单元格类型',
      '单元格单位',
      '水平对齐',
      '数字格式',
      '行高',
      '列宽',
      '合并范围',
      '切换报表',
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    }
    for (const name of [
      '保存（Ctrl+S）',
      '返回列表',
      '生成/查看',
      '函数向导（F8）',
      '审核公式',
      '清空当前格',
      '合并',
      '拆分当前合并',
    ]) {
      await expect(
        page.getByRole('button', { name, exact: name !== '保存（Ctrl+S）' }),
      ).toBeDisabled();
    }
    await expect(page.getByRole('checkbox', { name: '自动换行' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: '粗体' })).toBeDisabled();
    await page.keyboard.press('F8');
    await expect(page.getByRole('dialog', { name: '报表函数向导（F8）' })).toHaveCount(0);
    await page.keyboard.press('Control+s');
    await page.getByRole('menuitem', { name: '首页', exact: true }).click();
    await expect(page).toHaveURL(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
    expect(delayed.calls()).toBe(1);
    expect((await localDraft(page, bookId, report.id))!.template.cells[0]!.source).toBe(
      '第一次编辑',
    );
  } finally {
    await delayed.finish();
  }
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await expect(cell).toHaveValue('第一次编辑');
  await expect(cell).toBeEnabled();
  await cell.fill('保存后第二次编辑');
  await expect(page.getByText(/有未保存修改/)).toBeVisible();
  expect((await localDraft(page, bookId, report.id))!.template.cells[0]!.source).toBe(
    '保存后第二次编辑',
  );
  const second = await holdSaveResponse(page);
  try {
    // 同一浏览器事件轮次内连发快捷键，不能发出两个 expectedRevision 相同的请求。
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++)
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            code: 'KeyS',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
    });
    await second.received;
    expect(second.calls()).toBe(1);
    await expect(cell).toHaveValue('保存后第二次编辑');
  } finally {
    await second.finish();
  }
  await expect(page.getByText(/版本 3 · 已保存/)).toBeVisible();
  await page.getByLabel('切换报表', { exact: true }).click();
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: /^102 另一报表$/ })
    .click();
  await page.getByRole('button', { name: /查询$/ }).click();
  await expect(page).toHaveURL(`${isolated.baseURL}/m/report-engine/designer?id=${other.id}`);
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('另一报表原文');
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: report.id },
    { token },
  );
  expect(saved.template.cells[0]!.source).toBe('保存后第二次编辑');
  expect(saved.revision).toBe(3);
});

test('w_bb_def 延迟失败响应保留草稿，已打开的F8入口同样锁定，失败后可继续编辑', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request, { product: 'chengben' });
  const report = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    textTemplate('101', '保存失败', '原文'),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
  const cell = page.getByRole('textbox', { name: 'A1', exact: true });
  await cell.fill('失败也要保留的草稿');
  await page.keyboard.press('F8');
  const wizard = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  await wizard.getByRole('combobox').first().fill('1001');
  await page.keyboard.press('Enter');
  // 制造真实乐观锁失败；延迟的是服务端实际拒绝响应。
  await callApi(
    isolated.request,
    'm.report-engine.save',
    { id: report.id, expectedRevision: 1, template: { ...report.template, name: '外部新版本' } },
    { token, method: 'POST' },
  );
  const delayed = await holdSaveResponse(page);
  try {
    await page.keyboard.press('Control+s');
    await delayed.received;
    for (const input of await wizard.getByRole('combobox').all())
      await expect(input).toBeDisabled();
    await expect(wizard.getByRole('button', { name: '插入到当前单元格' })).toBeDisabled();
    expect((await localDraft(page, bookId, report.id))!.template.cells[0]!.source).toBe(
      '失败也要保留的草稿',
    );
  } finally {
    await delayed.finish();
  }
  await expect(wizard.getByRole('button', { name: '插入到当前单元格' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(wizard).not.toBeVisible();
  await expect(cell).toHaveValue('失败也要保留的草稿');
  await expect(cell).toBeEnabled();
  await expect(page.getByText(/有未保存修改/)).toBeVisible();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /报表已被其他操作修改/ })
      .first(),
  ).toBeVisible();
  await cell.fill('失败后继续编辑');
  const retry = page.waitForResponse((response) =>
    new URL(response.url()).pathname.includes('m.report-engine.save'),
  );
  await page.keyboard.press('Control+s');
  await retry;
  await expect(page.getByRole('button', { name: '保存（Ctrl+S）' })).toBeEnabled();
  await expect(cell).toHaveValue('失败后继续编辑');
  expect((await localDraft(page, bookId, report.id))!.template.cells[0]!.source).toBe(
    '失败后继续编辑',
  );
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: '返回列表', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(cell).toHaveValue('失败后继续编辑');
  await expect(page).toHaveURL(`${isolated.baseURL}/m/report-engine/designer?id=${report.id}`);
});
