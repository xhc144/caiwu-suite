import { callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { test, expect } from './fixture';

test('w_ht_htda 三个多行字段 Esc 共用离开保护，非法金额不提交，改正后保存关闭并回读', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  await isolated.seed(bookId, async (svc) => {
    await svc.accounts.create(
      {
        code: '100203',
        name: '合成合同银行',
        isBank: true,
        dimensions: [{ type: 'partner', required: true }],
      },
      [4, 2, 2],
    );
  });
  await page.goto(`${isolated.origin}/m/analysis/contracts`);
  await page.getByRole('button', { name: '新增合同', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增合同', exact: true });
  await editor.getByLabel('合同号', { exact: true }).fill('HT-ESC-RECOVERY');
  await editor.getByLabel('合同名称', { exact: true }).fill('合成关闭恢复合同');
  await editor.getByLabel('客供', { exact: true }).fill('C001');
  await page.keyboard.press('Enter');
  await editor.getByLabel('收付款科目', { exact: true }).fill('100203');
  await page.keyboard.press('Enter');
  await editor.getByLabel('合同金额', { exact: true }).fill('1.234');
  const text = { 合同说明: '说明保留', 备注1: '首备注保留', 备注2: '次备注保留' };
  for (const [label, value] of Object.entries(text)) {
    const field = editor.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.press('Escape');
    const leave = page.getByRole('dialog', { name: '合同尚未保存', exact: true });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(leave).toHaveCount(0);
    await expect(field).toHaveValue(value);
    await expect(editor.getByLabel('合同金额', { exact: true })).toHaveValue('1.234');
  }
  let saves = 0;
  page.on('request', (request) => {
    if (request.url().includes('m.analysis.contracts.save') && request.method() === 'POST') saves++;
  });
  await editor.getByLabel('备注2', { exact: true }).press('Escape');
  const leave = page.getByRole('dialog', { name: '合同尚未保存', exact: true });
  await leave.getByRole('button', { name: '保存后关闭', exact: true }).click();
  await expect(leave).toBeVisible();
  await expect(editor.getByText('金额或合同资料有误，尚未保存', { exact: true })).toBeVisible();
  expect(saves).toBe(0);
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(leave).toHaveCount(0);
  await editor.getByLabel('合同金额', { exact: true }).fill('0.01');
  await editor.getByLabel('备注2', { exact: true }).press('Escape');
  await leave.getByRole('button', { name: '保存后关闭', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(saves).toBe(1);
  const rows = await callApi<{ id: number; code: string }[]>(
    isolated.request,
    'm.analysis.contracts.list',
    undefined,
    { token, method: 'GET' },
  );
  const saved = await callApi<{
    amount: number;
    opening: number;
    description: string;
    remark: string;
    remark2: string;
  }>(
    isolated.request,
    'm.analysis.contracts.get',
    { id: rows.find((row) => row.code === 'HT-ESC-RECOVERY')!.id },
    { token, method: 'GET' },
  );
  expect(saved).toMatchObject({
    amount: 1,
    opening: 0,
    description: text.合同说明,
    remark: text.备注1,
    remark2: text.备注2,
  });
});
