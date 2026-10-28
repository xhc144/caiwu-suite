import { afterEach, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import payroll from '../server';
import { DEFAULT_FIELDS } from '../shared';

let app: TestApp;
afterEach(async () => app?.close());

it('工资产品边界：轻松管理员对全部只读和写入接口均明确拒绝，数据、设置、日志及辅助档案无副作用', async () => {
  app = await createTestApp({ modules: [payroll], product: 'qingsong' });
  const raw = app.runtime.bookStore.open(app.book.id).raw;
  const tables = (
    raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'payroll_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
  const capture = () => ({
    tables: tables.map((name) => ({ name, rows: raw.prepare(`SELECT * FROM "${name}"`).all() })),
    settings: raw.prepare("SELECT * FROM book_setting WHERE scope='payroll' ORDER BY key").all(),
    dimensions: raw.prepare('SELECT * FROM dimension_item ORDER BY id').all(),
    logs: raw.prepare('SELECT * FROM operation_log ORDER BY id').all(),
  });
  const before = capture();
  const caller = app.call(payroll) as unknown as Record<
    string,
    (input?: unknown) => Promise<unknown>
  >;
  const procedures = Object.keys(payroll.router._def.procedures);
  expect(procedures).toContain('categories');
  expect(procedures).toContain('saveCategory');
  for (const name of procedures) {
    await expect(caller[name]!()).rejects.toMatchObject({
      cause: { data: { code: 'PAYROLL_PRODUCT' } },
    });
  }
  expect(capture()).toEqual(before);
});

it.each(['minfei', 'chengben'] as const)(
  '工资产品边界：%s仍可真实保存，工资只读权限不能写入',
  async (product) => {
    app = await createTestApp({ modules: [payroll], product });
    const api = app.call(payroll);
    const category = await api.saveCategory({ name: '合成产品范围工资', fields: DEFAULT_FIELDS });
    expect(await api.categories()).toEqual([category]);
    const user = await app.addUser('payview', { permissions: ['payroll.salary.view'] });
    const readOnly = app.call(payroll, user);
    expect(await readOnly.categories()).toEqual([category]);
    await expect(
      readOnly.saveCategory({ name: '禁止写入', fields: DEFAULT_FIELDS }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(readOnly.confirmTax()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await api.categories()).toEqual([category]);
  },
);
