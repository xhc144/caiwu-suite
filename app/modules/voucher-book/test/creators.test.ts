import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
it('w_pz_pzxsb：制单人查询只返回安全字段，重名以账号区分且停用历史用户可选', async () => {
  const users = [];
  for (const code of ['maker-A', 'maker-B'])
    users.push(await app.svc.users.create({ code, name: '张三', password: 'example-only' }));
  await app.svc.db
    .updateTable('app_user')
    .set({ disabled: 1 })
    .where('id', '=', users[0]!.id)
    .execute();
  const reader = await app.addUser('reader', { permissions: ['voucher-book.view'] });
  const rows = await app.call(server, reader).creators();
  expect(rows.filter((u) => u.name === '张三').map((u) => [u.code, u.disabled])).toEqual([
    ['maker-A', 1],
    ['maker-B', 0],
  ]);
  for (const row of rows)
    expect(Object.keys(row).sort()).toEqual(['code', 'disabled', 'id', 'name']);
  const noView = await app.addUser('no-view');
  await expect(app.call(server, noView).creators()).rejects.toThrow(/权限/);
});
