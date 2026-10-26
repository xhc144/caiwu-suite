import { expect, type Locator, type Page } from '@playwright/test';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { balanceFormula, emptyTemplate, type Report, type ReportTemplate } from '../../shared';
import { test } from '../fixture';

const balance = balanceFormula({
  account: '1001',
  metric: 'closing',
  unit: 'cents',
  currency: 'CNY',
  direction: 'signed',
  dimension: 'none',
  item: '',
});
const cell = (address: string, source: string, kind: 'formula' | 'money' = 'formula') => ({
  address,
  source,
  kind,
  unit: 'cents' as const,
  currency: 'CNY',
});
function cashTemplate(code = '101'): ReportTemplate {
  const t = emptyTemplate({ code, name: `界面报表${code}`, rows: 3, cols: 3 });
  t.cells = [cell('A1', balance), cell('A2', '55', 'money')];
  return t;
}
async function choose(page: Page, input: Locator, label: string) {
  await input.click();
  await page
    .locator('.ant-select-item-option-content')
    .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .click();
}
async function openWizard(page: Page, address = 'B1') {
  await page.getByRole('textbox', { name: address, exact: true }).focus();
  await page.keyboard.press('F8');
  const wizard = page.getByRole('dialog', { name: '报表函数向导（F8）' });
  await expect(wizard).toBeVisible();
  return wizard;
}

test('w_bb_def_help SUM范围反例、组合运算符、保存重开和真实整数分取数', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6001', credit: 12345 },
      ],
    },
  ]);
  const r = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    cashTemplate(),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const wizard = await openWizard(page);
  await choose(page, wizard.getByLabel('函数类型', { exact: true }), '表内求和 SUM');
  await wizard.getByLabel('求和区域', { exact: true }).fill('A3:A1');
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(wizard.getByText('求和区域须为正向矩形，例如 A1:B3')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue('');
  await wizard.getByLabel('求和区域', { exact: true }).fill('A1:A2');
  await wizard.getByRole('button', { name: '加入组合公式' }).click();
  const expression = wizard.getByLabel('组合公式', { exact: true });
  await expect(expression).toHaveValue('SUM(A1:A2)');
  await expression.focus();
  await expression.press('End');
  await wizard.getByRole('button', { name: '插入运算符 *', exact: true }).click();
  await expect(expression).toBeFocused();
  await expression.pressSequentially('2');
  await expect(expression).toHaveValue('SUM(A1:A2)*2');
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue('SUM(A1:A2)*2');
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue('SUM(A1:A2)*2');
  await page.getByRole('button', { name: '生成/查看', exact: true }).click();
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-B1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '24800',
  );
});

test('w_bb_def_help REF可选当前账套报表、拒绝文本/越界、同期间现取来源表', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6001', credit: 12345 },
      ],
    },
  ]);
  const origin = cashTemplate();
  origin.cells.push({ ...cell('C1', '说明'), kind: 'text', unit: 'number' });
  await callApi(isolated.request, 'm.report-engine.importTemplate', origin, {
    token,
    method: 'POST',
  });
  const t = emptyTemplate({ code: '102', name: '表间取数', rows: 2, cols: 2 });
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', t, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const wizard = await openWizard(page);
  await choose(page, wizard.getByLabel('函数类型', { exact: true }), '表间引用 REF');
  await choose(page, wizard.getByLabel('来源报表', { exact: true }), '101 界面报表101');
  await wizard.getByLabel('来源单元格', { exact: true }).fill('D1');
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(wizard.getByText('引用地址超出来源报表行列范围')).toBeVisible();
  await wizard.getByLabel('来源单元格', { exact: true }).fill('C1');
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(wizard.getByText('文本单元格不能用于数值表间运算')).toBeVisible();
  await wizard.getByLabel('来源单元格', { exact: true }).fill('a1');
  await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue(
    'REF("101","A1")',
  );
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.getByRole('button', { name: '生成/查看', exact: true }).click();
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByTestId('result-B1').locator('[data-cents]')).toHaveAttribute(
    'data-cents',
    '12345',
  );
  await expect(page.getByText(/本次依赖定义：.*101（版本1）/)).toBeVisible();
});

test('w_bb_def_help 保留当前公式，语法反例不写单元格，取消不改变草稿；指南可达', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request);
  const r = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    cashTemplate(),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  const wizard = await openWizard(page, 'A1');
  const expression = wizard.getByLabel('组合公式', { exact: true });
  await expect(expression).toHaveValue(balance);
  for (const [source, error] of [
    ['SUM(A1:A2', '缺少或不匹配'],
    ['A1 A2', '无运算符'],
    ['EVIL(1)', '未知函数'],
  ] as const) {
    await expression.fill(source);
    await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
    await expect(wizard.getByRole('alert').filter({ hasText: error })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(balance);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByText(/版本 1 · 已保存/)).toBeVisible();
  await page.getByRole('button', { name: '报表函数指南', exact: true }).click();
  const guide = page.getByRole('dialog', { name: '报表函数指南', exact: true });
  await expect(guide).toContainText('REF("101","A1")');
  await expect(guide).toContainText('语法校验不读取账务数据');
});

test('w_bb_def 勾稽语法反例、负阈值与实际通过/不通过/错误分别呈现', async ({ page, isolated }) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '1001', debit: 12345 },
        { account: '6001', credit: 12345 },
      ],
    },
  ]);
  const t = cashTemplate();
  t.cells.push(cell('B1', 'SUM(A1:A2)'));
  t.checks = [
    { name: '总额核对', left: 'B1', right: 'SUM(A1:A2)', tolerance: '0' },
    { name: '差额核对', left: 'B1', right: 'A1', tolerance: '0' },
    { name: '单位核对', left: 'B1', right: '0', tolerance: '0' },
  ];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', t, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('button', { name: '审核公式', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '审核公式（勾稽）' });
  await drawer.getByLabel('审核1右表达式', { exact: true }).fill('A1 A2');
  await drawer.getByRole('button', { name: '校验审核语法' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: '无运算符' })).toBeVisible();
  await drawer.getByLabel('审核1右表达式', { exact: true }).fill('SUM(A1:A2)');
  await drawer.getByLabel('审核1阈值', { exact: true }).fill('-1');
  await drawer.getByRole('button', { name: '校验审核语法' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: '阈值使用非负十进制数' })).toBeVisible();
  await drawer.getByLabel('审核1阈值', { exact: true }).fill('0');
  await drawer.getByRole('button', { name: '校验审核语法' }).click();
  await expect(
    drawer.getByText('审核语法校验通过；单位、差额和实际引用将在生成时校验'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  await page.getByRole('button', { name: '生成/查看', exact: true }).click();
  await page.getByRole('button', { name: '生成/重算', exact: true }).click();
  await expect(page.getByText('总额核对：通过', { exact: true })).toBeVisible();
  await expect(page.getByText('差额核对：不通过', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '差额核对：不通过' })).toContainText(
    '差额 55',
  );
  await expect(page.getByRole('alert').filter({ hasText: '单位核对：错误' })).toContainText(
    '单位或币种不一致',
  );
});

test('w_bb_def 区域粘贴先确认，金额整数分、整批撤销/重做和保存持久化', async ({
  page,
  isolated,
}) => {
  const { token } = await loginWithNewBook(page, isolated.request);
  const t = emptyTemplate({ code: '101', name: '区域粘贴', rows: 3, cols: 3 });
  t.cells = [cell('A1', '100', 'money')];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', t, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('button', { name: '区域粘贴', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '区域粘贴（从 A1 开始）' });
  await choose(page, drawer.getByLabel('粘贴类型', { exact: true }), '全部作为金额（元）');
  await drawer.getByLabel('区域粘贴内容', { exact: true }).fill('123.45\t0.55\n-1.005\t');
  await drawer.getByRole('button', { name: '预览粘贴' }).click();
  await expect(drawer.getByText('将覆盖 A1:B2 共 4 格，其中已有内容 1 格')).toBeVisible();
  const get = () =>
    callApi<Report>(isolated.request, 'm.report-engine.get', { id: r.id }, { token });
  expect((await get()).template.cells).toEqual(t.cells);
  await drawer.getByRole('button', { name: '确认粘贴到草稿' }).click();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('123.45');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('1.00');
  await expect(page.getByRole('textbox', { name: 'B1', exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('-1.01');
  await page.getByRole('button', { name: '保存（Ctrl+S）' }).click();
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  expect((await get()).template.cells.map((c) => [c.address, c.source, c.kind])).toEqual([
    ['A1', '12345', 'money'],
    ['B1', '55', 'money'],
    ['A2', '-101', 'money'],
  ]);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'A2', exact: true })).toHaveValue('-1.01');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
});

test('w_bb_def 区域公式有一格语法错误整批不改，取消保留原草稿', async ({ page, isolated }) => {
  const { token } = await loginWithNewBook(page, isolated.request);
  const r = await callApi<Report>(
    isolated.request,
    'm.report-engine.importTemplate',
    cashTemplate(),
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('button', { name: '区域粘贴', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '区域粘贴（从 A1 开始）' });
  await choose(
    page,
    drawer.getByLabel('粘贴类型', { exact: true }),
    '全部作为公式（保留目标单位，未定义格默认本币分）',
  );
  await drawer.getByLabel('区域粘贴内容', { exact: true }).fill('SUM(A2:A2)\tSUM(');
  await drawer.getByRole('button', { name: '预览粘贴' }).click();
  await drawer.getByRole('button', { name: '确认粘贴到草稿' }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: /B1：.*缺少计算项/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue(balance);
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText(/版本 1 · 已保存/)).toBeVisible();
});

test('w_bb_def_help 校验响应晚于一次完整保存也不能写回过期公式', async ({ page, isolated }) => {
  const { token } = await loginWithNewBook(page, isolated.request);
  const t = emptyTemplate({ code: '101', name: '异步向导', rows: 2, cols: 2 });
  t.cells = [{ address: 'A1', source: '=1', kind: 'formula', unit: 'number', currency: 'CNY' }];
  const r = await callApi<Report>(isolated.request, 'm.report-engine.importTemplate', t, {
    token,
    method: 'POST',
  });
  await page.goto(`${isolated.baseURL}/m/report-engine/designer?id=${r.id}`);
  await page.getByRole('textbox', { name: 'A1', exact: true }).fill('=2');
  const wizard = await openWizard(page, 'A1');
  await wizard.getByLabel('组合公式', { exact: true }).fill('2+1');
  let received!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    received = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(
    (url) => url.pathname.includes('m.report-engine.validateFormula'),
    async (route) => {
      calls++;
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    },
  );
  try {
    await wizard.getByRole('button', { name: '插入到当前单元格' }).click();
    await ready;
    await page.keyboard.press('Control+s');
    await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await expect(wizard.getByRole('button', { name: '插入到当前单元格' })).toBeEnabled();
  expect(calls).toBe(1);
  await expect(page.getByRole('textbox', { name: 'A1', exact: true })).toHaveValue('=2');
  await expect(page.getByText(/版本 2 · 已保存/)).toBeVisible();
  const saved = await callApi<Report>(
    isolated.request,
    'm.report-engine.get',
    { id: r.id },
    { token },
  );
  expect(saved.template.cells[0]!.source).toBe('=2');
});
