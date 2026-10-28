import { expect, type Page, type Response, type Request } from '@playwright/test';
import { callApi } from '@caiwu/testkit/e2e';
import type { StatutoryProfile } from '../shared';
import type { EnterpriseConfig, SourceData } from '../templates/enterprise/model';
import { statutoryEvidence, statutoryIdentity } from '../test/statutory-fixture';
import { test } from './fixture';

function requestInput(request: Request) {
  const value = JSON.parse(
    request.postData() ?? new URL(request.url()).searchParams.get('input') ?? '{}',
  );
  return value['0'] ?? value;
}
async function selectPeriod(page: Page, period: number) {
  await page.getByRole('combobox', { name: '报告期间', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: String(period) })
    .click();
}
async function editorResponse(response: Response) {
  const payload = await response.json();
  const record = Array.isArray(payload) ? payload[0] : payload;
  expect(record.error).toBeUndefined();
  return record.result.data as { configuration: EnterpriseConfig; source: SourceData };
}

for (const unsaved of [false, true]) {
  test(`w_bb_def 真实企业组件12月→11月→12月保留${unsaved ? '未保存' : '已保存'}完整配置并正式保存`, async ({
    page,
    isolated,
  }) => {
    const { bookId, configuration } = await isolated.prepareStatutoryBook();
    const login = await callApi<{ token: string; user: unknown; book: unknown }>(
      isolated.request,
      'core.auth.login',
      { bookId, userCode: 'admin', password: 'admin' },
      { method: 'POST' },
    );
    const auth = { token: login.token, method: 'POST' as const };
    configuration.scope = 'yearToDate';
    await isolated.seed(bookId, [
      {
        date: '2025-12-15',
        status: 'posted',
        lines: [
          { account: '1001', debit: 10000 },
          { account: '4001', credit: 10000 },
        ],
      },
    ]);
    const decemberSource = await callApi<{ source: SourceData }>(
      isolated.request,
      'm.report-engine.statutory.editor',
      { ...statutoryIdentity, period: 202512, scope: 'yearToDate' },
      { token: login.token, method: 'GET' },
    );
    const cash = decemberSource.source.entries.find((entry) => entry.accountCode === '1001')!;
    const capital = decemberSource.source.entries.find((entry) => entry.accountCode === '4001')!;
    configuration.cashAllocations = [
      {
        lineId: cash.lineId,
        parts: [{ line: 'capitalReceipts', amount: '10000' }],
        ...statutoryEvidence,
      },
    ];
    configuration.equityEvents = [
      {
        lineId: capital.lineId,
        row: 'ordinaryContributions',
        liabilityAmount: '0',
        parts: [{ column: 'capital', amount: '10000' }],
        ...statutoryEvidence,
      },
    ];
    for (const year of [2024, 2025])
      configuration.eps.push({
        from: year * 100 + 1,
        to: year * 100 + 11,
        applicable: false,
        preference: '0',
        dilutions: [],
        ...statutoryEvidence,
      });
    const profile = await callApi<StatutoryProfile>(
      isolated.request,
      'm.report-engine.statutory.save',
      { ...statutoryIdentity, code: '201', name: '完整草稿往返合成报表', configuration },
      auth,
    );
    await page.addInitScript(
      (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
      { ...login, bookId },
    );
    await page.goto(`${isolated.baseURL}/m/report-engine/statutory?id=${profile.id}`);
    await expect(page.getByRole('button', { name: '保存并确认来源' })).toBeVisible();
    let expected = structuredClone(configuration);
    if (unsaved) {
      await page.getByRole('tab', { name: '现金范围与逐笔分配', exact: true }).click();
      const december = page
        .locator('fieldset')
        .filter({ has: page.locator('legend', { hasText: '202512 期末现金范围' }) });
      await december
        .getByRole('textbox', { name: '依据来源', exact: true })
        .fill('十二月尚未保存的现金政策依据');
      expected = {
        ...expected,
        cashPolicies: expected.cashPolicies.map((item) =>
          item.period === 202512 && item.basis === 'closing'
            ? { ...item, source: '十二月尚未保存的现金政策依据' }
            : item,
        ),
      };
    }
    for (const period of [202511, 202512]) {
      const response = page.waitForResponse(
        (r) =>
          r.url().includes('statutory.editorDraft') && requestInput(r.request()).period === period,
      );
      await selectPeriod(page, period);
      const result = await editorResponse(await response);
      expect(result.configuration).toEqual({ ...expected, period });
      expect(
        result.source.balances[period]!.find((row) => row.accountCode === '1001')!.closing,
      ).toBe(period === 202511 ? 100000 : 110000);
      expect(result.source.entries.map((entry) => entry.lineId)).toEqual(
        period === 202511 ? [] : decemberSource.source.entries.map((entry) => entry.lineId),
      );
      expect(result.source.balances[period === 202511 ? 202512 : 202511]).toBeUndefined();
      await expect(page.getByRole('combobox', { name: '报告期间', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    const transport = page.waitForRequest(
      (r) => r.url().includes('statutory.editorDraft') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: '保存并确认来源' }).click();
    const raw = JSON.parse((await transport).postData()!);
    const submitted = raw['0'] ?? raw;
    expect(submitted.options.enterpriseDraft.configuration).toEqual(expected);
    await expect(page.getByText('已保存配置版本 2；', { exact: false })).toBeVisible();
    const saved = await callApi<StatutoryProfile>(
      isolated.request,
      'm.report-engine.statutory.get',
      { id: profile.id },
      { token: login.token, method: 'GET' },
    );
    expect(saved.configuration).toEqual(expected);
    await page.reload();
    await page.getByRole('tab', { name: '现金范围与逐笔分配', exact: true }).click();
    const december = page
      .locator('fieldset')
      .filter({ has: page.locator('legend', { hasText: '202512 期末现金范围' }) });
    await expect(december.getByRole('textbox', { name: '依据来源', exact: true })).toHaveValue(
      expected.cashPolicies.find((item) => item.period === 202512 && item.basis === 'closing')!
        .source,
    );
  });
}

test('w_bb_def 真实期间来源响应逆序返回后仍以最新报告日完整草稿保存', async ({
  page,
  isolated,
}) => {
  const { bookId, configuration } = await isolated.prepareStatutoryBook();
  const login = await callApi<{ token: string; user: unknown; book: unknown }>(
    isolated.request,
    'core.auth.login',
    { bookId, userCode: 'admin', password: 'admin' },
    { method: 'POST' },
  );
  configuration.scope = 'yearToDate';
  const profile = await callApi<StatutoryProfile>(
    isolated.request,
    'm.report-engine.statutory.save',
    { ...statutoryIdentity, code: '201', name: '期间竞态合成报表', configuration },
    { token: login.token, method: 'POST' },
  );
  await page.addInitScript(
    (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
    { ...login, bookId },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/statutory?id=${profile.id}`);
  const policy = page.getByRole('textbox', { name: '依据来源', exact: true }).first();
  await policy.fill('异步读取期间继续编辑的政策依据');
  const expected = {
    ...configuration,
    adoption: { ...configuration.adoption, source: '异步读取期间继续编辑的政策依据' },
  };
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const novemberReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let november: Awaited<ReturnType<typeof editorResponse>> | undefined;
  await page.route('**/trpc/*statutory.editorDraft*', async (route) => {
    if (requestInput(route.request()).period === 202511) {
      const response = await route.fetch();
      const payload = await response.json();
      november = (Array.isArray(payload) ? payload[0] : payload).result.data;
      ready();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await selectPeriod(page, 202511);
    await novemberReady;
    expect(november!.source.balances[202511]).toBeDefined();
    expect(november!.source.balances[202512]).toBeUndefined();
    expect(november!.configuration.cashPolicies).toEqual(configuration.cashPolicies);
    const decemberResponse = page.waitForResponse(
      (r) =>
        r.url().includes('statutory.editorDraft') && requestInput(r.request()).period === 202512,
    );
    await selectPeriod(page, 202512);
    expect((await editorResponse(await decemberResponse)).source.balances[202512]).toBeDefined();
    const late = page.waitForResponse(
      (r) =>
        r.url().includes('statutory.editorDraft') && requestInput(r.request()).period === 202511,
    );
    release();
    await late;
    await expect(policy).toHaveValue(expected.adoption.source);
    const rebuilt = page.waitForRequest(
      (r) => r.url().includes('statutory.editorDraft') && r.method() === 'POST',
    );
    await page.getByRole('button', { name: '保存并确认来源' }).click();
    const raw = JSON.parse((await rebuilt).postData()!);
    expect((raw['0'] ?? raw).period).toBe(202512);
    expect((raw['0'] ?? raw).options.enterpriseDraft.configuration).toEqual(expected);
    await expect(page.getByText('已保存配置版本 2；', { exact: false })).toBeVisible();
    const saved = await callApi<StatutoryProfile>(
      isolated.request,
      'm.report-engine.statutory.get',
      { id: profile.id },
      { token: login.token, method: 'GET' },
    );
    expect(saved.configuration).toEqual(expected);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
