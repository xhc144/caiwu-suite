import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapTemplateScheme, parseCodeScheme, parseTemplate } from '@caiwu/core';
import { createRuntime, defineServerModule } from '@caiwu/server-kit';
import { createTestApp } from '@caiwu/testkit';
import templatesServer from '../server';
import { expectedAccounts, expectedTemplates } from './expected-accounts';
import { loadedAccountSnapshot } from './template-fixtures';

const templates = templatesServer.templates.map((raw) => parseTemplate(raw));
const input = (templateId: string, name = '制度加载测试') => ({
  name,
  orgName: '临时测试单位',
  templateId,
  product: 'chengben' as const,
  startYear: 2026,
  startMonth: 1,
  adminPassword: 'admin',
});

describe.each(expectedTemplates)('w_xt_kgzb_1 / w_xt_kgzb_3：$id 真实SQLite', (expected) => {
  it('确认的制度和级次落库，完整读取科目、类别、方向；重复建账不重复加载', async () => {
    const app = await createTestApp({
      modules: [templatesServer],
      templateId: expected.id,
      seed: false,
    });
    try {
      const template = templates.find((t) => t.id === expected.id)!;
      const rows = await app.svc.accounts.list();
      expect(rows).toMatchObject(loadedAccountSnapshot(template, rows));
      expect(rows).toHaveLength(template.accounts.length);
      expect(
        rows
          .filter((row) => row.level === 1)
          .map(({ code, name, categoryId, direction }) => ({
            code,
            name,
            categoryId,
            direction,
          })),
      ).toEqual(expectedAccounts(expected));
      expect(await app.core().accounts.list()).toEqual(rows);
      expect(await app.svc.accounts.categories()).toEqual(
        expected.categories.map((c, sort) => ({ ...c, sort })),
      );
      expect(await app.svc.book.info()).toMatchObject({
        templateId: expected.id,
        regime: expected.regime,
        templateName: template.name,
        codeScheme: parseCodeScheme(template.codeScheme),
        baseCurrency: 'CNY',
        startPeriod: 202601,
      });
      expect((await app.svc.reference.currencies()).map((c) => c.code)).toEqual(['CNY']);
      expect(
        (await app.svc.reference.voucherTypes()).map(({ code, name }) => ({ code, name })),
      ).toEqual(template.voucherTypes);
      expect(await app.svc.dimensions.items()).toEqual([]);
      expect(await app.svc.periods.list()).toHaveLength(12);
      expect((await app.core().auth.me()).user.code).toBe('admin');
      const second = await app.core().books.create(input(expected.id, '相同制度第二账套'));
      expect(second.id).not.toBe(app.book.id);
      const { token } = await app
        .core(null)
        .auth.login({ bookId: second.id, userCode: 'admin', password: 'admin' });
      const secondRows = await app.core(token).accounts.list();
      expect(secondRows).toMatchObject(loadedAccountSnapshot(template, secondRows));
      expect(secondRows).toHaveLength(template.accounts.length);
      expect(new Set(secondRows.map((a) => a.code)).size).toBe(template.accounts.length);
      expect(await app.svc.accounts.list()).toEqual(rows);
      await app.runtime.bookStore.close(second.id);
      app.runtime.bookStore.open(second.id);
      expect(await app.core(token).accounts.list()).toEqual(secondRows);
    } finally {
      await app.close();
    }
  });

  it('w_xt_kgzb_a2 阻止未选择制度；w_xt_kgzb_1 阻止错误级次，不留半成品', async () => {
    const app = await createTestApp({
      modules: [templatesServer],
      templateId: expected.id,
      seed: false,
    });
    try {
      const before = readdirSync(app.runtime.bookStore.booksDir).sort();
      const books = await app.core().books.list();
      await expect(app.core().books.create(input(''))).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(app.core().books.create(input('missing-template'))).rejects.toThrow(/不存在/);
      await expect(
        app.core().books.create({
          ...input(expected.id),
          codeScheme: expected.width === 4 ? '3-2-2' : '4-2-2',
        }),
      ).rejects.toThrow(/不能使用科目级次/);
      expect(await app.core().books.list()).toEqual(books);
      expect(readdirSync(app.runtime.bookStore.booksDir).sort()).toEqual(before);
      expect(
        readdirSync(app.runtime.bookStore.booksDir).some((name) => name.includes('.creating')),
      ).toBe(false);
      await expect(app.core(null).accounts.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(app.core(null).accounts.categories()).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    } finally {
      await app.close();
    }
  });
});

it('w_xt_kgzb_3：事务加载到最后科目失败时回滚、清理 .creating，保留已有账套', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-templates-rollback-'));
  // schema合法但同一科目重复维度触发真实SQLite唯一约束；不mock数据库或建账流程。
  const base = templates[0]!;
  const broken = {
    ...base,
    id: 'broken-dimensions',
    accounts: base.accounts.map((a, i) =>
      i === base.accounts.length - 1
        ? {
            ...a,
            dimensions: [
              { type: 'department', required: true },
              { type: 'department', required: true },
            ],
          }
        : a,
    ),
  };
  const module = defineServerModule(templatesServer.manifest, {
    router: templatesServer.router,
    templates: [...templatesServer.templates, broken],
  });
  const runtime = createRuntime({ dataDir, modules: [module], devMode: false });
  try {
    const good = await runtime.bookStore.create(input(base.id));
    await runtime.bookStore.closeAll();
    const files = readdirSync(runtime.bookStore.booksDir).sort();
    await expect(runtime.bookStore.create(input(broken.id))).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
    expect(readdirSync(runtime.bookStore.booksDir).sort()).toEqual(files);
    expect((await runtime.bookStore.list()).map((b) => b.id)).toEqual([good.id]);
    expect(runtime.bookStore.exists(good.id)).toBe(true);
  } finally {
    await runtime.bookStore.closeAll();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

it('w_xt_kgzb_a2：切换制度和令牌不串科目，级次按账套参数加载', async () => {
  const app = await createTestApp({
    modules: [templatesServer],
    templateId: 'nonprofit-2026',
    seed: false,
  });
  try {
    const original = await app.core().accounts.list();
    const book = await app
      .core()
      .books.create({ ...input('rural-collective-2024'), codeScheme: '3-3-3' });
    const { token } = await app
      .core(null)
      .auth.login({ bookId: book.id, userCode: 'admin', password: 'admin' });
    const rural = templates.find((t) => t.id === 'rural-collective-2024')!;
    const mapped = mapTemplateScheme(rural, parseCodeScheme('3-3-3'));
    const ruralRows = await app.core(token).accounts.list();
    expect(ruralRows).toHaveLength(mapped.accounts.length);
    expect(ruralRows.filter((a) => a.level === 1)).toHaveLength(42);
    expect(ruralRows).toMatchObject(loadedAccountSnapshot(mapped, ruralRows));
    expect((await app.core(token).accounts.list()).some((a) => a.code === '1506')).toBe(false);
    expect((await app.core(token).auth.me()).book.codeScheme).toEqual([3, 3, 3]);
    expect(await app.core().accounts.list()).toEqual(original);
  } finally {
    await app.close();
  }
});
