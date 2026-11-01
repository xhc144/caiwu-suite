import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import analysis from '../server';
import { definitionService } from '../server/custom';

let app: TestApp;
let sourceId: string;
beforeEach(async () => {
  app = await createTestApp({ modules: [analysis] });
  sourceId = (
    await app.runtime.bookStore.create({
      name: '合成来源账套',
      orgName: '合成来源单位',
      templateId: 'demo-enterprise',
      product: 'chengben',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'source-test',
    })
  ).id;
});
afterEach(async () => app?.close());
const credentials = () => ({ bookId: sourceId, userCode: 'admin', password: 'source-test' });
const withSource = async <T>(fn: (svc: ReturnType<typeof createCoreServices>) => Promise<T>) =>
  app.runtime.bookStore.withBook(sourceId, async (book) => {
    const user = (await loadServiceUser(book.db, 1))!;
    return fn(
      createCoreServices({
        db: book.db,
        user,
        moduleId: 'analysis',
        modules: app.runtime.modules.lookup,
        providers: app.runtime.modules.providers,
        now: app.runtime.now,
      }),
    );
  });
const seed = () =>
  withSource((svc) =>
    definitionService(svc).save({
      code: '7',
      name: '来源现金分析',
      expectedRevision: 0,
      rows: [{ key: 1, name: '现金', formula: '余额("1001")', unit: 'money', subtotal: false }],
    }),
  );
describe('w_fx_copy 跨账套定义复制', () => {
  it('来源独立认证，只复制定义，目标独立编号与版本，源表不变', async () => {
    const source = await seed();
    const api = app.call(analysis);
    const list = await api.definitions.sources(credentials());
    expect(list).toEqual([{ id: source.id, code: '007', name: '来源现金分析', revision: 1 }]);
    const copied = await api.definitions.copy({
      source: credentials(),
      definitionId: source.id,
      sourceRevision: 1,
      code: '8',
      name: '当前现金分析',
    });
    expect(copied).toMatchObject({
      code: '008',
      name: '当前现金分析',
      revision: 1,
      rows: source.rows,
    });
    expect((await withSource((svc) => definitionService(svc).get(source.id))).code).toBe('007');
    expect(await api.results.list()).toEqual([]);
    expect((await api.definitions.get({ id: copied.id })).rows).toEqual(source.rows);
  });
  it('错误口令、不存在/停用来源操作员及权限不足均拒绝且不暴露来源定义', async () => {
    await seed();
    const api = app.call(analysis);
    await expect(api.definitions.sources({ ...credentials(), password: 'wrong' })).rejects.toThrow(
      '来源账套无法访问',
    );
    await withSource(async (svc) => {
      await svc.users.create({ code: 'limited', name: '无权限', password: 'limited-test' });
    });
    await expect(
      api.definitions.sources({ ...credentials(), userCode: 'limited', password: 'limited-test' }),
    ).rejects.toThrow('来源账套无法访问');
    await expect(
      api.definitions.sources({ ...credentials(), userCode: 'missing' }),
    ).rejects.toThrow('来源账套无法访问');
    expect(await api.definitions.list()).toEqual([]);
  });
  it('源版本变化、目标编号重复、空名称、缺来源与缺目标科目均不留下半张表', async () => {
    const source = await seed();
    const api = app.call(analysis);
    const input = {
      source: credentials(),
      definitionId: source.id,
      sourceRevision: 1,
      code: '8',
      name: '副本',
    };
    await expect(api.definitions.copy({ ...input, name: '' })).rejects.toThrow();
    await expect(
      api.definitions.copy({ ...input, source: { ...credentials(), bookId: '' } }),
    ).rejects.toThrow();
    await expect(api.definitions.copy({ ...input, definitionId: 99999 })).rejects.toThrow('不存在');
    await withSource((svc) =>
      definitionService(svc).save({ ...source, expectedRevision: 1, name: '改名' }),
    );
    await expect(api.definitions.copy(input)).rejects.toThrow('来源分析表已修改');
    await api.definitions.copy({ ...input, sourceRevision: 2 });
    await expect(api.definitions.copy({ ...input, sourceRevision: 2 })).rejects.toThrow('编号重复');
    await app.svc.db.deleteFrom('account').where('code', '=', '1001').execute();
    await expect(api.definitions.copy({ ...input, code: '9', sourceRevision: 2 })).rejects.toThrow(
      '不存在',
    );
    expect(await api.definitions.list()).toHaveLength(1);
  });
  it('目标维护与查看权限分别验证，来源只读操作员可复制定义', async () => {
    const source = await seed();
    await withSource(async (svc) => {
      await svc.users.create({
        code: 'reader',
        name: '来源只读',
        password: 'reader-test',
        permissions: ['analysis.view'],
      });
    });
    const targetToken = await app.addUser('editor', { permissions: ['analysis.definition.edit'] });
    await expect(
      app.call(analysis, targetToken).definitions.sources(credentials()),
    ).rejects.toThrow();
    const copied = await app.call(analysis).definitions.copy({
      source: { ...credentials(), userCode: 'reader', password: 'reader-test' },
      definitionId: source.id,
      sourceRevision: 1,
      code: '1',
      name: '只读来源复制',
    });
    expect(copied.rows).toEqual(source.rows);
  });
});
