import { expect, test, request as requestFactory, type Page } from '@playwright/test';
import { loginWithNewBook } from '@caiwu/testkit/e2e';
import { voucherInputFromSpec } from '@caiwu/testkit';
import { entryService } from '../server/service';
import type { EntryTables } from '../server/migrations';
import type { SaveInput } from '../shared';
import { fixture } from './fixture';

// 只延迟真实请求的响应；请求仍经过 HTTP、router、事务与真实账套。
async function holdFirstSave(page: Page) {
  const calls: SaveInput[] = [];
  let release!: () => void;
  let processed!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const saved = new Promise<void>((resolve) => (processed = resolve));
  await page.route('**/trpc/m.voucher-entry.save*', async (route) => {
    const input = Object.values(route.request().postDataJSON() as Record<string, SaveInput>)[0]!;
    calls.push(input);
    const first = calls.length === 1;
    const response = await route.fetch();
    if (first) {
      processed();
      await gate;
    }
    await route.fulfill({ response });
  });
  return { calls, saved, release: () => release() };
}

async function openDraft(page: Page, local: Awaited<ReturnType<typeof fixture>>) {
  const request = await requestFactory.newContext({ baseURL: local.url });
  try {
    const { bookId } = await loginWithNewBook(page, request, { seed: false });
    const svc = await local.seed(bookId);
    const key = 'autosave-regression';
    const service = entryService(svc);
    const draft = await service.save({
      key,
      bufferRevision: 0,
      data: {
        ...(await voucherInputFromSpec(svc, {
          date: '2026-01-10',
          lines: [
            { account: '6603', debit: 7100, summary: '原摘要' },
            { account: '6001', credit: 7100, summary: '收入' },
          ],
        })),
        draft: true,
      },
    });
    await page.addInitScript(
      ({ bookId, key }) => sessionStorage.setItem(`voucher-entry.new.${bookId}`, key),
      { bookId, key },
    );
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByRole('status')).toContainText('已恢复');
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('原摘要');
    await page.clock.install();
    const buffer = () =>
      svc.db
        .withTables<EntryTables>()
        .selectFrom('voucher_entry_buffer')
        .selectAll()
        .where('client_key', '=', key)
        .executeTakeFirstOrThrow();
    return { svc, service, draft, buffer };
  } finally {
    await request.dispose();
  }
}

test('w_pz_pzedit：正式保存后过期排队自动保存不发请求、不改缓冲、不误恢复；手动草稿仍执行', async ({
  page,
}) => {
  const local = await fixture();
  const gate = await holdFirstSave(page);
  try {
    const { svc, draft, buffer } = await openDraft(page, local);
    await page.getByLabel('第1行摘要', { exact: true }).fill('正式保存版本');
    await page.keyboard.press('Control+s');
    await gate.saved;
    const formalBuffer = await buffer();
    expect(JSON.parse(formalBuffer.payload)).toMatchObject({ draft: false });
    // 正式请求尚未返回，此时防抖必然以 dirty 状态把自动保存排到其后。
    await page.clock.runFor(900);
    gate.release();
    await expect.soft(page.getByRole('status')).toContainText('已保存 记-0001');
    await page.getByRole('link', { name: '重新打开凭证', exact: true }).click();
    await expect.soft(page.getByRole('status')).toContainText('已恢复；尚未修改');
    expect.soft(gate.calls.map((call) => call.data.draft)).toEqual([false]);
    expect.soft(await buffer()).toEqual(formalBuffer);
    expect(await svc.vouchers.get(draft.voucher!.id)).toMatchObject({
      status: 'pending',
      number: 1,
      debitTotal: 7100,
      creditTotal: 7100,
    });
    await expect.soft(page.getByRole('status')).not.toContainText('未提交暂存内容');
    // dirty 已清零时的显式保存草稿不能被自动保存的去重规则吞掉。
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('暂存内容已保存，正式凭证待手动保存');
    expect(gate.calls.map((call) => call.data.draft)).toEqual([false, true]);
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
    await local.close();
  }
});

test('w_pz_pzedit_b：保存期间真实新编辑继续自动保存，旧响应不覆盖；重复正式保存和切页保留最新草稿', async ({
  page,
}) => {
  const local = await fixture();
  const gate = await holdFirstSave(page);
  try {
    const { svc, draft, buffer } = await openDraft(page, local);
    await page.getByLabel('第1行摘要', { exact: true }).fill('正式保存版本');
    await page.keyboard.press('Control+s');
    await gate.saved;
    await page.getByLabel('第1行摘要', { exact: true }).fill('保存中第一次修改');
    await page.clock.runFor(900);
    await page.getByLabel('第1行摘要', { exact: true }).fill('保存中新增修改');
    await page.clock.runFor(900);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存中新增修改');
    // 两次自动保存已排队；切页必须等待队列，后一个自动保存应合并为 no-op。
    await page.getByRole('button', { name: '科目维护', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/voucher-entry/new`);
    gate.release();
    await expect(page).toHaveURL(`${local.url}/m/accounts`);
    expect(gate.calls.map((call) => call.data.draft)).toEqual([false, true]);
    const buffered = await buffer();
    expect(buffered.revision).toBe(draft.bufferRevision + 2);
    expect(JSON.parse(buffered.payload).lines[0].summary).toBe('保存中新增修改');
    const formal = (await svc.vouchers.get(draft.voucher!.id))!;
    expect(formal.lines[0]!.summary).toBe('正式保存版本');
    expect(formal).toMatchObject({
      status: 'pending',
      number: 1,
      debitTotal: 7100,
      creditTotal: 7100,
    });
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('保存中新增修改');
    expect(await buffer()).toEqual(buffered);
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+s');
    await expect
      .poll(async () => (await svc.vouchers.get(formal.id))!.revision)
      .toBe(formal.revision + 2);
    expect((await svc.vouchers.list({})).total).toBe(1);
    expect((await svc.vouchers.get(formal.id))!.lines[0]!.summary).toBe('保存中新增修改');
    expect(gate.calls.map((call) => call.data.draft)).toEqual([false, true, false, false]);
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
    await local.close();
  }
});

test('w_pz_pzedit.u_pzsave：正式保存失败仍保留 dirty，已排队自动保存持久化草稿并可切页恢复', async ({
  page,
}) => {
  const local = await fixture();
  const gate = await holdFirstSave(page);
  try {
    const { svc, draft, buffer } = await openDraft(page, local);
    await page.getByLabel('第1行摘要', { exact: true }).fill('失败后仍需保留');
    await page.getByLabel('第2行贷方', { exact: true }).fill('70.99');
    await page.getByLabel('第1行摘要', { exact: true }).focus();
    await page.keyboard.press('Control+s');
    await gate.saved;
    await page.clock.runFor(900);
    gate.release();
    await expect(page.getByRole('status')).toContainText('草稿与暂存内容已保存');
    expect(gate.calls.map((call) => call.data.draft)).toEqual([false, true]);
    expect((await buffer()).revision).toBe(draft.bufferRevision + 1);
    expect(await svc.vouchers.get(draft.voucher!.id)).toMatchObject({
      status: 'draft',
      number: null,
    });
    await page.getByRole('button', { name: '科目维护', exact: true }).click();
    await expect(page).toHaveURL(`${local.url}/m/accounts`);
    await page.goto(`${local.url}/m/voucher-entry/new`);
    await expect(page.getByLabel('第1行摘要', { exact: true })).toHaveValue('失败后仍需保留');
    await expect(page.getByLabel('第2行贷方', { exact: true })).toHaveValue('70.99');
  } finally {
    gate.release();
    await page.unrouteAll({ behavior: 'wait' });
    await local.close();
  }
});
