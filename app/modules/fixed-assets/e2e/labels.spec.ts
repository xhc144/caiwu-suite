import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';

async function prepare(page: Page, request: APIRequestContext) {
  const { token } = await loginWithNewBook(page, request, { product: 'minfei' });
  const post = <T>(name: string, input: unknown) =>
    callApi<T>(request, `m.fixed-assets.${name}`, input, { token, method: 'POST' });
  const categoryId = await post<number>('saveMaster', {
    data: { kind: 'category', code: '01', name: '设备类' },
  });
  const purposeId = await post<number>('saveMaster', {
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  const statusId = await post<number>('saveMaster', {
    data: { kind: 'status', code: '01', name: '在用' },
  });
  const department = await callApi<{ id: number; code: string }[]>(
    request,
    'core.dimensions.items',
    { type: 'department' },
    { token, method: 'GET' },
  );
  for (const [code, acquired] of [
    ['Z99', '2026-01-01'],
    ['A01', '2026-01-01'],
    ['B02', '2026-01-01'],
    ['A00', '2026-07-01'],
  ] as const)
    await post('save', {
      data: {
        code,
        name: `标签设备${code}`,
        categoryId,
        purposeId,
        statusId,
        departmentId: department.find((d) => d.code === '01')!.id,
        acquired,
        useDate: acquired,
        original: 10000,
        rate: '0',
        method: '1',
        lifeMonths: 60,
      },
    });
}
async function select(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').getByText(text, { exact: true }).click();
}
async function observePrint(page: Page) {
  return page.evaluateHandle(() => {
    const events: { phase: string; trusted: boolean; html: string; text: string; pages: number }[] =
      [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (
            !(node instanceof HTMLIFrameElement) ||
            node.getAttribute('aria-label') !== '系统打印'
          )
            continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(
                  phase,
                  (event) => {
                    const doc = node.contentDocument!;
                    events.push({
                      phase,
                      trusted: event.isTrusted,
                      html: doc.documentElement.outerHTML,
                      text: doc.body.textContent!,
                      pages: doc.querySelectorAll('.print-sheet').length,
                    });
                    if (phase === 'afterprint') observer.disconnect();
                  },
                  { once: true },
                );
            },
            { capture: true, once: true },
          );
        }
    });
    observer.observe(document.body, { childList: true });
    return events;
  });
}

test('w_zcgl_label：记录序号范围、彩色分页缩放预览、HTML文件与原生打印保持一致', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await prepare(page, request);
  await page.goto('/m/fixed-assets/reports?kind=labels&year=2026&cutoff=2026-06-30');
  await expect(page.getByText(/范围内共 3 条，本次输出 3 张/)).toBeVisible();
  await expect(page.getByRole('row', { name: /1 A01 标签设备A01/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /A00/ })).toHaveCount(0);
  await select(page, '标签范围', '按标签序号');
  await page.getByLabel('起始序号', { exact: true }).fill('2');
  await page.getByLabel('截止序号', { exact: true }).fill('3');
  await select(page, '打印颜色', '彩色');
  await expect(page.getByRole('button', { name: '预览资产标签', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByText(/范围内共 3 条，本次输出 2 张/)).toBeVisible();
  await expect(page.getByRole('row', { name: /2 B02 标签设备B02/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /A01/ })).toHaveCount(0);
  await page.getByRole('button', { name: '预览资产标签', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '资产标签预览', exact: true });
  const paper = page.frameLocator('iframe[title="资产标签纸张预览"]');
  await expect(paper.getByText('标签设备B02', { exact: false })).toBeVisible();
  await expect(preview.getByText('第 1 / 2 张；标签序号 2', { exact: true })).toBeVisible();
  const measured = await paper.locator('.print-sheet').evaluate((sheet) => {
    const content = sheet.querySelector('.scaled')!;
    return {
      width: sheet.getBoundingClientRect().width,
      height: sheet.getBoundingClientRect().height,
      fits: content.getBoundingClientRect().bottom <= sheet.getBoundingClientRect().bottom + 1,
      color: getComputedStyle(sheet).color,
    };
  });
  expect(measured.width).toBeCloseTo((80 * 96) / 25.4, 0);
  expect(measured.height).toBeCloseTo((43 * 96) / 25.4, 0);
  expect(measured.fits).toBe(true);
  expect(measured.color).toBe('rgb(22, 75, 130)');
  await preview.getByRole('button', { name: '下一张', exact: true }).click();
  await expect(paper.getByText('标签设备Z99', { exact: false })).toBeVisible();
  await expect(preview.getByRole('button', { name: '下一张', exact: true })).toBeDisabled();
  await preview.getByRole('button', { name: '放大', exact: true }).click();
  await expect(preview.getByText('175%', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(preview.getByText('150%', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await preview.getByRole('button', { name: '保存标签 HTML 文件', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('固定资产标签.html');
  const html = await readFile((await file.path())!, 'utf8');
  expect(html).toContain('88mm 51mm');
  expect(html).toContain('标签设备B02');
  expect(html).toContain('标签设备Z99');
  expect(html).not.toContain('标签设备A01');
  const printed = await observePrint(page);
  await preview.getByRole('button', { name: '打印标签', exact: true }).click();
  await expect
    .poll(() => printed.evaluate((events) => events.map((e) => e.phase)))
    .toEqual(['beforeprint', 'afterprint']);
  const events = await printed.jsonValue();
  expect(events.every((e) => e.trusted)).toBe(true);
  expect(events[0]!.pages).toBe(2);
  expect(events[0]!.html).toContain('88mm 51mm');
  expect(events[0]!.text).toContain('标签设备B02');
  expect(events[0]!.text).toContain('标签设备Z99');
  expect(events[0]!.text).not.toContain('标签设备A01');
  await printed.dispose();
  await preview.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('起始序号', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('截止序号', { exact: true })).toHaveValue('3');
  await expect(page.getByText(/本次输出 2 张/)).toBeVisible();
  await page.getByLabel('起始序号', { exact: true }).fill('4');
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByText('起始序号不能大于截止序号', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '预览资产标签', exact: true })).toBeDisabled();
  await page.getByLabel('截止序号', { exact: true }).fill('9');
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByText(/本次输出 0 张/)).toBeVisible();
  await expect(page.getByRole('button', { name: '预览资产标签', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打印当前报表', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '保存标签 HTML 文件', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
});

test('w_zcgl_label：加载、旧响应及失败期间禁止沿用旧标签预览、打印和导出', async ({
  page,
  request,
}) => {
  await prepare(page, request);
  await page.goto('/m/fixed-assets/reports?kind=labels&year=2026&cutoff=2026-06-30');
  await expect(page.getByText(/本次输出 3 张/)).toBeVisible();
  let releaseOld!: () => void;
  let oldStarted!: () => void;
  let oldFinished!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const started = new Promise<void>((resolve) => {
    oldStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    oldFinished = resolve;
  });
  await page.route('**/trpc/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('m.fixed-assets.reports')) return route.continue();
    const input = JSON.parse(url.searchParams.get('input') ?? '{}') as Record<
      string,
      { fromCode?: string }
    >;
    if (!Object.values(input).some((v) => v.fromCode === 'B')) return route.continue();
    const response = await route.fetch();
    oldStarted();
    await held;
    await route.fulfill({ response });
    oldFinished();
  });
  try {
    await page.getByLabel('编号从', { exact: true }).fill('B');
    await page.getByRole('button', { name: '查询报表', exact: true }).click();
    await started;
    await expect(page.getByRole('button', { name: '预览资产标签', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '打印当前报表', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
    await page.getByLabel('编号从', { exact: true }).fill('Z');
    await page.getByRole('button', { name: '查询报表', exact: true }).click();
    await expect(page.getByText(/本次输出 1 张/)).toBeVisible();
    releaseOld();
    await finished;
    await expect(page.getByRole('row', { name: /Z99 标签设备Z99/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /B02/ })).toHaveCount(0);
  } finally {
    releaseOld();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await page.route('**/trpc/**', async (route) => {
    if (route.request().url().includes('m.fixed-assets.reports')) await route.abort('failed');
    else await route.continue();
  });
  await page.getByLabel('编号从', { exact: true }).fill('A');
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByText('查询失败，请重试', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /标签设备/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览资产标签', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /导出 Excel$/ })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '查询报表', exact: true }).click();
  await expect(page.getByText(/本次输出 3 张/)).toBeVisible();
});
