import { describe, expect, it } from 'vitest';
import {
  defineMigrations,
  openDatabase,
  orderByDependencies,
  runMigrations,
  withTransaction,
} from '../src';

describe('迁移', () => {
  it('只执行一次，内容被改时报错', () => {
    const { raw } = openDatabase(':memory:');
    const set = {
      scope: 'm',
      migrations: defineMigrations([{ id: '0001_init', sql: 'CREATE TABLE m_a (id INTEGER)' }]),
    };
    expect(runMigrations(raw, [set]).applied).toHaveLength(1);
    expect(runMigrations(raw, [set]).applied).toHaveLength(0);
    const changed = {
      scope: 'm',
      migrations: defineMigrations([{ id: '0001_init', sql: 'CREATE TABLE m_b (id INTEGER)' }]),
    };
    expect(() => runMigrations(raw, [changed])).toThrow(/内容被改了/);
  });

  it('失败的迁移整体回滚', () => {
    const { raw } = openDatabase(':memory:');
    const set = {
      scope: 'm',
      migrations: defineMigrations([
        { id: '0001_bad', sql: 'CREATE TABLE m_a (id INTEGER); CREATE TABLE m_a (id INTEGER);' },
      ]),
    };
    expect(() => runMigrations(raw, [set])).toThrow(/执行迁移 m\/0001_bad 失败/);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'm_a'").get()).toBeUndefined();
  });

  it('迁移 id 格式', () => {
    expect(() => defineMigrations([{ id: 'init', sql: '' }])).toThrow(/格式不对/);
  });

  it('按依赖排序，检测缺失和成环', () => {
    const order = orderByDependencies([
      { id: 'costing', dependsOn: ['inventory'] },
      { id: 'inventory' },
      { id: 'books' },
    ]).map((m) => m.id);
    expect(order).toEqual(['books', 'inventory', 'costing']);
    expect(() => orderByDependencies([{ id: 'a', dependsOn: ['x'] }])).toThrow(/不存在/);
    expect(() =>
      orderByDependencies([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(/成环/);
  });
});

describe('事务', () => {
  it('事务里误用事务外的连接会直接报错而不是卡死', async () => {
    const { db, raw } = openDatabase<{ t: { id: number } }>(':memory:');
    raw.exec('CREATE TABLE t (id INTEGER)');
    await expect(
      withTransaction(db, async () => {
        await db.selectFrom('t').selectAll().execute();
      }),
    ).rejects.toThrow(/事务外的数据库连接/);
    await withTransaction(db, async (trx) => {
      await trx.insertInto('t').values({ id: 1 }).execute();
    });
    expect(await db.selectFrom('t').selectAll().execute()).toEqual([{ id: 1 }]);
  });
});
