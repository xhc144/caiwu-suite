import { test, expect } from './fixture';
import { bankBook, documents, recordThree } from './scenarios';

test('w_cn_pz 手工输入首张凭证号生成整批，预览全部编号影响后撤销并实际重排', async ({
  cashier,
}) => {
  const book = await bankBook(cashier);
  await recordThree(cashier, book);
  const earlier = await cashier.withServices(book.bookId, async (svc) => {
    await svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    return svc.vouchers.create({
      voucherTypeId: book.voucherTypeId,
      date: '2026-01-10',
      number: 1,
      lines: [
        {
          accountId: (await svc.accounts.require('100201')).id,
          summary: '批次前保留凭证',
          debit: 100,
          dimensions: { cashflow: book.cashflow },
        },
        {
          accountId: (await svc.accounts.require('6603')).id,
          summary: '批次前保留凭证',
          credit: 100,
        },
      ],
    });
  });
  const { page } = cashier;
  await page.goto('/m/cashier/documents');
  await expect(page.getByRole('row', { name: /客户到账/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: '生成凭证预览', exact: true }).click();
  const generate = page.getByRole('dialog', { name: '凭证生成预览', exact: true });
  await generate.getByLabel('第一张凭证号', { exact: true }).fill('10');
  await generate.getByRole('button', { name: '预览分录', exact: true }).click();
  await expect(generate.getByText('第 1 张（10号）', { exact: true })).toHaveCount(2);
  await expect(generate.getByText('第 2 张（11号）', { exact: true })).toHaveCount(2);
  await expect(generate.getByText('第 3 张（12号）', { exact: true })).toHaveCount(2);
  await generate.getByRole('button', { name: '确认生成待审核凭证', exact: true }).click();
  await expect(generate).not.toBeVisible();
  await expect(page.getByText('来源锁定', { exact: true })).toHaveCount(3);
  const saved = await documents(cashier, book);
  const sourceIds = [...new Set(saved.map((row) => row.voucherId!))];
  const batchId = saved[0]!.batchId!;
  const later = await cashier.withServices(book.bookId, async (svc) => {
    const numbers = await Promise.all(
      sourceIds.map(async (id) => (await svc.vouchers.get(id))!.number),
    );
    expect(numbers).toEqual([10, 11, 12]);
    const manual = await svc.vouchers.create({
      voucherTypeId: book.voucherTypeId,
      date: '2026-01-10',
      number: 20,
      lines: [
        {
          accountId: (await svc.accounts.require('100201')).id,
          summary: '后续凭证重排',
          debit: 200,
          dimensions: { cashflow: book.cashflow },
        },
        {
          accountId: (await svc.accounts.require('6603')).id,
          summary: '后续凭证重排',
          credit: 200,
        },
      ],
    });
    await svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: true,
      allowModifyOthers: true,
    });
    return manual;
  });
  await page.getByRole('button', { name: '撤销生成', exact: true }).first().click();
  const revoke = page.getByRole('dialog', { name: `撤销出纳凭证批次 ${batchId}`, exact: true });
  for (const number of ['记-0010', '记-0011', '记-0012'])
    await expect(revoke.getByText(number, { exact: true })).toBeVisible();
  await expect(revoke.getByText('账套已启用删除后重排编号，以下列出完整编号影响')).toBeVisible();
  const changed = revoke.getByRole('row').filter({ hasText: '重排' });
  await expect(changed).toHaveCount(1);
  await expect(changed).toContainText('20');
  await expect(changed).toContainText('2');
  await expect(revoke.getByRole('row').filter({ hasText: '保留' })).toHaveCount(1);
  await revoke.getByRole('button', { name: '确认整批撤销', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: `撤销出纳生成批次 ${batchId}`, exact: true });
  await expect(
    confirm.getByRole('button', { name: '确认撤销并按计划处理编号', exact: true }),
  ).toBeDisabled();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  expect((await documents(cashier, book)).every((row) => row.voucherId != null)).toBe(true);
  await revoke.getByRole('button', { name: '确认整批撤销', exact: true }).click();
  confirm = page.getByRole('dialog', { name: `撤销出纳生成批次 ${batchId}`, exact: true });
  await confirm.getByLabel('确认文字').fill('撤销生成');
  await confirm.getByRole('button', { name: '确认撤销并按计划处理编号', exact: true }).click();
  await expect(revoke).not.toBeVisible();
  await expect(page.getByText('来源锁定', { exact: true })).toHaveCount(0);
  const remaining = await documents(cashier, book);
  expect(remaining.map((row) => [row.id, row.amount, row.voucherId])).toEqual(
    saved.map((row) => [row.id, row.amount, null]),
  );
  await cashier.withServices(book.bookId, async (svc) => {
    for (const id of sourceIds) expect(await svc.vouchers.get(id)).toBeNull();
    expect(await svc.vouchers.get(earlier.id)).toMatchObject({ number: 1 });
    expect(await svc.vouchers.get(later.id)).toMatchObject({ number: 2 });
  });
});
