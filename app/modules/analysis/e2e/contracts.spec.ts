import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';

test('w_ht_htda→审核→w_ht_pz明确关联→w_ht_httj金额、Excel与原生打印', async ({
  page,
  isolated,
}) => {
  const { bookId } = await loginWithNewBook(page, isolated.request);
  let voucherId = 0;
  await isolated.seed(bookId, async (svc) => {
    await svc.accounts.create(
      {
        code: '100203',
        name: '合同银行',
        isBank: true,
        dimensions: [{ type: 'partner', required: true }],
      },
      [4, 2, 2],
    );
    const [voucher] = await seedVouchers(svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '100203', debit: 25000, summary: '明确收款250元', dims: { partner: 'C001' } },
          { account: '6001', credit: 25000 },
        ],
      },
    ]);
    voucherId = voucher!.id;
    await seedVouchers(svc, [
      {
        date: '2026-01-16',
        status: 'posted',
        lines: [
          {
            account: '100203',
            debit: 99900,
            summary: 'HT-UI 相同摘要未关联',
            dims: { partner: 'C001' },
          },
          { account: '6001', credit: 99900 },
        ],
      },
    ]);
  });
  await page.goto(`${isolated.origin}/m/analysis/contracts`);
  await expect(page.getByRole('heading', { name: '合同档案管理' })).toBeVisible();
  await page.getByRole('button', { name: '新增合同' }).click();
  const editor = page.getByRole('dialog', { name: '新增合同' });
  await editor.getByLabel('合同号', { exact: true }).fill('HT-UI');
  await editor.getByLabel('合同名称').fill('浏览器合成合同');
  await editor.getByLabel('客供', { exact: true }).fill('C001');
  await page.keyboard.press('Enter');
  await editor.getByLabel('收付款科目').fill('100203');
  await page.keyboard.press('Enter');
  await editor.getByLabel('合同金额', { exact: true }).fill('1000');
  await editor.getByLabel('期初收付款').fill('100');
  await editor.getByLabel('合同说明').fill('交付说明；到期日未提供');
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: '合同尚未保存', exact: true })
    .getByRole('button', { name: '继续编辑', exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('合同名称')).toHaveValue('浏览器合成合同');
  await editor.getByRole('button', { name: '保存合同', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'HT-UI', exact: true }).click();
  let detail = page.getByRole('dialog', { name: '合同 HT-UI', exact: true });
  await expect(detail).toContainText('交付说明；到期日未提供');
  await detail.getByRole('button', { name: '审核合同', exact: true }).click();
  await expect(detail.getByRole('button', { name: '取消合同审核' })).toBeEnabled();
  await expect(detail.getByRole('button', { name: '修改合同', exact: true })).toBeDisabled();
  await detail.getByRole('spinbutton', { name: '凭证ID', exact: true }).fill(String(voucherId));
  await detail.getByRole('button', { name: '查询凭证分录' }).click();
  await expect(detail.getByText('明确收款250元', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '关联此分录' }).click();
  await expect(detail.getByRole('button', { name: '取消关联', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await page.getByRole('link', { name: '合同账款查询', exact: true }).click();
  await expect(page.getByRole('heading', { name: '合同账款查询' })).toBeVisible();
  await expect(page.getByTestId('contract-totals')).toContainText(
    '合同金额：1,000.00；本期收付：250.00；累计收付：350.00；未完成：650.00',
  );
  const reportRow = page.getByRole('row').filter({ hasText: 'HT-UI' });
  await expect(reportRow).toContainText('未知');
  await expect(reportRow).toContainText('交付说明；到期日未提供');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出合同Excel' }).click();
  const download = await downloading;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Uint8Array.from(await readFile((await download.path())!)).buffer);
  const ws = wb.getWorksheet('合同账款')!;
  expect(ws.getCell('F4').value).toBe(1000);
  expect(ws.getCell('G4').value).toBe(100);
  expect(ws.getCell('H4').value).toBe(250);
  expect(ws.getCell('I4').value).toBe(350);
  expect(ws.getCell('J4').value).toBe(650);
  expect(ws.getCell('K4').value).toBe('未知');
  expect(wb.getWorksheet('关联分录')!.getCell('B2').value).toBe(voucherId);
  const printed = await page.evaluateHandle(() => {
    const events: { phase: string; trusted: boolean; text: string }[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations)
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          node.addEventListener(
            'load',
            () => {
              for (const phase of ['beforeprint', 'afterprint'])
                node.contentWindow!.addEventListener(
                  phase,
                  (event) => {
                    events.push({
                      phase,
                      trusted: event.isTrusted,
                      text: node.contentDocument!.body.textContent!,
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
  await page.getByRole('button', { name: '打印合同账款' }).click();
  await expect
    .poll(() => printed.evaluate((events) => events.map((event) => event.phase)))
    .toEqual(['beforeprint', 'afterprint']);
  const printEvents = await printed.jsonValue();
  expect(printEvents.every((event) => event.trusted)).toBe(true);
  expect(printEvents[0]!.text).toContain('650.00');
  expect(printEvents[0]!.text).toContain('原始到期日和逾期天数未知');
  await expect(page.locator('iframe')).toHaveCount(0);
  await printed.dispose();
  await reportRow.getByRole('link', { name: 'HT-UI' }).click();
  detail = page.getByRole('dialog', { name: '合同 HT-UI', exact: true });
  await expect(detail.getByRole('link', { name: /记-/ })).toHaveAttribute(
    'href',
    `/m/voucher-entry/edit?id=${voucherId}`,
  );
});

test('w_ht_htda：已用禁删、取消删除保留、取消关联确认、本人反审核与真实删除', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  let accountId = 0;
  let partnerId = 0;
  let voucherId = 0;
  let lineId = 0;
  await isolated.seed(bookId, async (svc) => {
    const account = await svc.accounts.create(
      {
        code: '100203',
        name: '合同银行',
        isBank: true,
        dimensions: [{ type: 'partner', required: true }],
      },
      [4, 2, 2],
    );
    accountId = account.id;
    partnerId = (await svc.dimensions.getByCode('partner', 'C001'))!.id;
    const [voucher] = await seedVouchers(svc, [
      {
        date: '2026-01-15',
        status: 'posted',
        lines: [
          { account: '100203', debit: 25000, dims: { partner: 'C001' } },
          { account: '6001', credit: 25000 },
        ],
      },
    ]);
    voucherId = voucher!.id;
    lineId = voucher!.lines[0]!.id;
  });
  const row = await callApi<{ id: number; revision: number }>(
    isolated.request,
    'm.analysis.contracts.save',
    {
      expectedRevision: 0,
      code: 'HT-UI',
      name: '浏览器合成合同',
      partnerId,
      accountId,
      signedDate: '2026-01-01',
      kind: 'receipt',
      amount: 100000,
      opening: 10000,
      description: '交付说明；到期日未提供',
      remark: '',
    },
    { token, method: 'POST' },
  );
  const reviewed = await callApi<{ id: number; revision: number }>(
    isolated.request,
    'm.analysis.contracts.review',
    { id: row.id, expectedRevision: row.revision, reviewed: true },
    { token, method: 'POST' },
  );
  await callApi(
    isolated.request,
    'm.analysis.contracts.link',
    { id: row.id, expectedRevision: reviewed.revision, voucherId, lineId },
    { token, method: 'POST' },
  );
  await page.goto(`${isolated.origin}/m/analysis/contracts?id=${row.id}`);
  const detail = page.getByRole('dialog', { name: '合同 HT-UI', exact: true });
  await expect(detail.getByRole('button', { name: '取消关联', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '删除合同', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('此合同已经使用，不能删除', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除合同 HT-UI？', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '取消关联', exact: true }).click();
  await page.getByRole('button', { name: '保留关联' }).click();
  await expect(detail.getByRole('button', { name: '取消关联', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '取消关联', exact: true }).click();
  await page.getByRole('button', { name: '确认取消关联' }).click();
  await expect(detail.getByRole('button', { name: '取消关联', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '取消合同审核' }).click();
  await expect(detail.getByRole('button', { name: '审核合同', exact: true })).toBeEnabled();
  await detail.getByRole('button', { name: '删除合同', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '删除合同', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'HT-UI', exact: true })).toHaveCount(0);
});
