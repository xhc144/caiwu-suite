import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test('w_ht_htda 金额非法、越界、负数失焦后保留原文，所有保存入口拒绝，刷新恢复后改正保存', async ({
  page,
  isolated,
}) => {
  test.setTimeout(120_000);
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  let accountId = 0,
    partnerId = 0;
  await isolated.seed(bookId, async (svc) => {
    accountId = (
      await svc.accounts.create(
        {
          code: '100203',
          name: '合同银行',
          isBank: true,
          dimensions: [{ type: 'partner', required: true }],
        },
        [4, 2, 2],
      )
    ).id;
    partnerId = (await svc.dimensions.getByCode('partner', 'C001'))!.id;
  });
  const original = await callApi<{ id: number; revision: number }>(
    isolated.request,
    'm.analysis.contracts.save',
    {
      expectedRevision: 0,
      code: 'HT-MONEY',
      name: '金额原文测试',
      accountId,
      partnerId,
      signedDate: '2026-01-01',
      kind: 'receipt',
      amount: 12345,
      opening: 678,
    },
    { token },
  );
  await page.goto(`${isolated.origin}/m/analysis/contracts?id=${original.id}`);
  const details = page.getByRole('dialog', { name: '合同 HT-MONEY', exact: true });
  await details.getByRole('button', { name: '修改合同', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '修改合同 HT-MONEY', exact: true });
  let saveRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('m.analysis.contracts.save') && request.method() === 'POST')
      saveRequests++;
  });
  const amount = editor.getByLabel('合同金额', { exact: true });
  const opening = editor.getByLabel('期初收付款', { exact: true });
  for (const raw of [
    '不是金额',
    '90071992547409.92',
    '-1',
    '1.234',
    '0.001',
    '90071992547409.911',
    '-0.001',
  ]) {
    await amount.fill('123.45');
    await amount.fill(raw);
    await editor.getByLabel('合同名称').focus();
    await expect(amount).toHaveValue(raw);
    await page.keyboard.press('Control+s');
    await expect(editor.getByText('金额或合同资料有误，尚未保存')).toBeVisible();
    await expect(amount).toHaveValue(raw);
    await editor.getByRole('button', { name: '保存合同', exact: true }).click();
    await expect(amount).toHaveValue(raw);
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    const leave = page.getByRole('dialog', { name: '合同尚未保存', exact: true });
    await leave.getByRole('button', { name: '保存后关闭', exact: true }).click();
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(amount).toHaveValue(raw);
  }
  expect(saveRequests).toBe(0);
  await amount.fill('90071992547409.91');
  await opening.fill('无效期初');
  await editor.getByLabel('合同名称').focus();
  await page.keyboard.press('Control+s');
  await expect(opening).toHaveValue('无效期初');
  expect(saveRequests).toBe(0);
  await amount.fill('90071992547409.92');
  const before = await callApi<{ amount: number; opening: number }>(
    isolated.request,
    'm.analysis.contracts.get',
    { id: original.id },
    { token, method: 'GET' },
  );
  expect(before).toMatchObject({ amount: 12345, opening: 678 });
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await details.getByRole('button', { name: '修改合同', exact: true }).click();
  await editor.getByRole('button', { name: '恢复合同草稿', exact: true }).click();
  await expect(amount).toHaveValue('90071992547409.92');
  await expect(opening).toHaveValue('无效期初');
  await page.keyboard.press('Control+s');
  await expect(editor.getByText('金额或合同资料有误，尚未保存')).toBeVisible();
  await amount.fill('90071992547409.91');
  await opening.fill('0.01');
  await editor.getByRole('button', { name: '保存合同', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = await callApi<{ amount: number; opening: number }>(
    isolated.request,
    'm.analysis.contracts.get',
    { id: original.id },
    { token, method: 'GET' },
  );
  expect(saved).toMatchObject({ amount: Number.MAX_SAFE_INTEGER, opening: 1 });
});
