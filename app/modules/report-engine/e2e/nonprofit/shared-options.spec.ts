import { expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { callApi } from '@caiwu/testkit/e2e';
import type { Report, ReportTemplate } from '../../shared';
import { balance401AnnualTemplate } from '../../templates/nonprofit/balance-sheet';
import { balanceFixtureMapping } from '../../test/nonprofit/balance-fixture';
import { activity402TotalsTemplate } from '../../templates/nonprofit/activity-totals';
import { activityFixtureMapping } from '../../test/nonprofit/activity-fixture';
import { comparativeCashflow403Template } from '../../templates/nonprofit/cashflow-comparative';
import { fixtureMapping } from '../../test/nonprofit/fixture';
import { test } from './fixture';

for (const scenario of [
  {
    kind: 'balance' as const,
    period: 202602,
    template: () =>
      balance401AnnualTemplate(balanceFixtureMapping(), balanceFixtureMapping(202601)),
    golden: { B37: 2490, C37: 2490, E28: 2490, F28: 2490 },
  },
  {
    kind: 'activity' as const,
    period: 202602,
    template: () => activity402TotalsTemplate(activityFixtureMapping()),
    golden: { D14: 170, D26: 20, G14: 1170, G26: 170, B6: '待接入真实取数', G30: '待接入真实取数' },
  },
  {
    kind: 'comparative' as const,
    period: 202702,
    template: () =>
      comparativeCashflow403Template({
        current: { ...fixtureMapping(), year: 2027 },
        previous: fixtureMapping(),
      }, 202702),
    golden: { B41: 300, C41: 1217, B6: 330, C6: 980 },
  },
]) {
  test(`共享options联合浏览器取数 ${scenario.kind}：独立账套→真实生成→xlsx保留金额与未完成标记`, async ({
    page,
    nonprofit,
  }) => {
    const bookId = await nonprofit.createBook(scenario.kind);
    const login = await callApi<{ token: string; user: unknown; book: unknown }>(
      nonprofit.request,
      'core.auth.login',
      { bookId, userCode: 'admin', password: 'admin' },
    );
    await page.addInitScript(
      (session) => sessionStorage.setItem('caiwu.session', JSON.stringify(session)),
      { token: login.token, bookId, user: login.user, book: login.book },
    );
    const template: ReportTemplate = scenario.template();
    const r = await callApi<Report>(nonprofit.request, 'm.report-engine.importTemplate', template, {
      token: login.token,
      method: 'POST',
    });
    await page.goto(
      `${nonprofit.baseURL}/m/report-engine/view?id=${r.id}&period=${scenario.period}`,
    );
    await page.getByRole('button', { name: '生成/重算' }).click();
    if (scenario.kind === 'comparative')
      await page
        .getByRole('dialog', { name: '生成前发现未过账凭证' })
        .getByRole('button', { name: '按所选口径继续生成' })
        .click();
    await expect(page.getByTestId('result-A1')).toContainText('切片');
    const wait = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel' }).click();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile((await (await wait).path())!);
    const ws = wb.worksheets[0]!;
    for (const [address, expected] of Object.entries(scenario.golden))
      expect(ws.getCell(address).value).toBe(expected);
    expect(ws.getCell('A1').value).toContain('切片');
  });
}
