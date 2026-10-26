import { loginWithNewBook, callApi } from '@caiwu/testkit/e2e';
import type { Page } from '@playwright/test';
import type { Invoice, Settings } from '../shared';
import { single } from '../test/fixtures';
import { createInvoiceAccounts } from './data';
import { test, expect } from './isolated';

async function choose(page: Page, label: string, code: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByLabel(label, { exact: true }).fill(code);
  await page.getByLabel(label, { exact: true }).press('Enter');
}
for (const [product, direction] of [
  ['qingsong', 'input'],
  ['chengben', 'output'],
] as const) {
  test(`w_fp_sz/_2 → w_fp_pz ${product}/${direction}：参数入口、预览零写入、明确确认新增和来源凭证`, async ({
    page,
    isolated,
  }) => {
    const { request, origin, inBook } = isolated;
    const { bookId, token } = await loginWithNewBook(page, request, { product });
    const cfg = await inBook(bookId, async (svc) => {
      const base = await createInvoiceAccounts(svc);
      const scheme = (await svc.book.info()).codeScheme;
      await svc.accounts.create(
        { code: '9800', name: '合成往来上级', categoryId: 'liability' },
        scheme,
      );
      await svc.accounts.create({ code: '980001', name: '合成已有往来' }, scheme);
      return { ...base, direction };
    });
    await callApi(request, 'm.invoice.saveSettings', cfg, { token });
    for (const [i, name] of ['合成已有往来', '合成新增往来'].entries()) {
      await callApi(
        request,
        'm.invoice.save',
        {
          data: single({
            direction,
            number: `E2E-PARTNER-${i}`,
            date: '2026-02-05',
            confirmDate: direction === 'input' ? '2026-02-05' : null,
            sellerName: direction === 'input' ? name : '合成销方',
            buyerName: direction === 'output' ? name : '合成购方',
          }),
        },
        { token },
      );
    }
    const docs = await callApi<Invoice[]>(request, 'm.invoice.list', {}, { token, method: 'GET' });
    await callApi(
      request,
      'm.invoice.audit',
      { selection: docs.map(({ id, revision }) => ({ id, revision })), to: 'audited' },
      { token },
    );
    await page.goto(`${origin}/m/invoice/settings?direction=${direction}`);
    await page.getByLabel('往来科目匹配方式', { exact: true }).click();
    await page.getByText('按客供名称精确匹配下级科目，缺少时确认新增', { exact: true }).click();
    await choose(page, direction === 'input' ? '应付/结算科目' : '应收/结算科目', '9800');
    const saved = page.waitForResponse(
      (r) => r.url().includes('m.invoice.saveSettings') && r.status() === 200,
    );
    await page.getByRole('button', { name: '保存映射', exact: true }).click();
    await saved;
    const settings = await callApi<Settings>(
      request,
      'm.invoice.settings',
      { direction },
      { token, method: 'GET' },
    );
    expect(settings.settlementMode).toBe('partnerName');
    await page.goto(`${origin}/m/invoice/process?direction=${direction}&period=202602`);
    await page.getByRole('columnheader').getByRole('checkbox').check();
    await page.getByLabel('凭证日期', { exact: true }).fill('2026-02-28');
    await page.getByLabel('凭证字', { exact: true }).click();
    await page.getByText('记账凭证', { exact: true }).click();
    await page.getByRole('button', { name: '预览分录', exact: true }).click();
    await expect(page.getByText('拟新增往来下级科目（尚未保存）', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('listitem').filter({ hasText: '980002 合成往来上级/合成新增往来' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '确认生成凭证', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消预览', exact: true }).click();
    await expect(page.getByText('拟新增往来下级科目（尚未保存）', { exact: true })).toBeHidden();
    await inBook(bookId, async (svc) => {
      expect(await svc.accounts.getByCode('980002')).toBeNull();
      expect((await svc.vouchers.list({ sourceModule: 'invoice' })).total).toBe(0);
    });
    await page.getByRole('button', { name: '预览分录', exact: true }).click();
    await expect(page.getByLabel('已核对并同意新增以上科目', { exact: true })).not.toBeChecked();
    await page.getByLabel('已核对并同意新增以上科目', { exact: true }).check();
    await page.getByRole('button', { name: '确认生成凭证', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await expect(page.getByText('拟新增往来下级科目（尚未保存）', { exact: true })).toBeHidden();
    await expect(page.getByRole('link', { name: '记-0001', exact: true }).last()).toHaveAttribute(
      'href',
      /\/m\/voucher-entry\/edit\?id=\d+/,
    );
    const generated = await callApi<Invoice[]>(
      request,
      'm.invoice.list',
      {},
      { token, method: 'GET' },
    );
    expect(
      generated.every((d) => d.state === 'generated' && d.voucherId === generated[0]!.voucherId),
    ).toBe(true);
    await inBook(bookId, async (svc) => {
      const a = (await svc.accounts.getByCode('980002'))!;
      expect(a.name).toBe('合成新增往来');
      const vouchers = await svc.vouchers.list({ sourceModule: 'invoice' });
      expect(vouchers.total).toBe(1);
      const voucher = (await svc.vouchers.get(generated[0]!.voucherId!))!;
      expect(voucher.lines.find((l) => l.accountId === a.id)).toMatchObject(
        direction === 'input' ? { credit: 11000 } : { debit: 11000 },
      );
    });
  });
}
