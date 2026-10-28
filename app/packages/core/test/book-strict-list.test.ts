import { randomUUID } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createTestBook, type TestBook } from '@caiwu/testkit';

let book: TestBook;
afterEach(async () => book?.close());
const request = JSON.stringify({ sourceId: 'synthetic-source', requestId: 'R', name: '合成副本' });
const copyInput = {
  name: '合成副本',
  orgName: '合成单位',
  templateId: 'demo-enterprise',
  product: 'qingsong' as const,
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'synthetic-password',
};
const managedFiles = () =>
  readdirSync(book.store.booksDir)
    .filter((name) => name.endsWith('.caiwu'))
    .sort();
async function retryCopy(lostResponse = false) {
  for (const candidate of await book.store.listStrict()) {
    const matches = await book.store.withBook(candidate.id, async (target) => {
      const receipt = await target.db
        .selectFrom('book_setting')
        .select('value')
        .where('scope', '=', 'books')
        .where('key', '=', 'copyReceipt')
        .executeTakeFirst();
      return receipt?.value === request;
    });
    if (matches) return candidate.id;
  }
  const copied = await book.store.create(copyInput);
  await book.store.withBook(copied.id, async (target) => {
    await target.db
      .insertInto('book_setting')
      .values({
        scope: 'books',
        key: 'copyReceipt',
        value: request,
        updated_at: new Date().toISOString(),
      })
      .execute();
  });
  if (lostResponse) throw new Error('合成响应丢失');
  return copied.id;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('w_xt_tz：复制R成功D但响应丢失，D在重试前已维护时严格发现拒绝，不能再创建D2', async () => {
  book = await createTestBook();
  await expect(retryCopy(true)).rejects.toThrow('合成响应丢失');
  const copies = (await book.store.listStrict()).filter((row) => row.id !== book.info.id);
  expect(copies).toHaveLength(1);
  const copied = copies[0]!;
  const before = managedFiles();
  const entered = deferred(),
    release = deferred();
  const maintaining = book.store.maintain(copied.id, {
    kind: 'reconnect',
    prepare: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  await entered.promise;
  try {
    expect((await book.store.list()).map((row) => row.id)).toEqual([book.info.id]);
    await expect(retryCopy()).rejects.toMatchObject({ data: { code: 'BOOK_MAINTENANCE' } });
    expect(managedFiles()).toEqual(before);
  } finally {
    release.resolve();
    await maintaining;
  }
  expect(await retryCopy()).toBe(copied.id);
  expect(await book.store.listStrict()).toHaveLength(2);
});

it.each(['损坏文件', '文件身份错误', '未知文件名'] as const)(
  'w_xt_tz：严格发现遇到%s拒绝，普通UI列表仍容错',
  async (fault) => {
    book = await createTestBook();
    const other = await book.store.create(copyInput);
    if (fault === '文件身份错误')
      book.store
        .open(other.id)
        .raw.prepare('UPDATE book_info SET book_id=? WHERE id=1')
        .run(randomUUID());
    else {
      await book.store.close(other.id);
      writeFileSync(
        fault === '未知文件名'
          ? path.join(book.store.booksDir, 'synthetic-unknown.caiwu')
          : book.store.pathOf(other.id),
        '合成无法读取文件',
      );
    }
    const before = managedFiles();
    await expect(retryCopy()).rejects.toMatchObject({ data: { code: 'BOOK_SCAN_INCOMPLETE' } });
    expect(managedFiles()).toEqual(before);
    await expect(book.store.list()).resolves.toEqual(expect.any(Array));
  },
);
