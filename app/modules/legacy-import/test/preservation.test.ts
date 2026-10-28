import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from '@caiwu/db';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { ImportTables } from '../server/migrations';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());

describe('w_bb_saveas 原始文件保全', () => {
  it('乱码及未闭合CSV在预检失败、刷新后仍能按字节取回，且隔离其他操作员', async () => {
    const api = app.call(server);
    const files = [
      {
        name: '损坏编码.csv',
        kind: 'accounts' as const,
        contentBase64: Buffer.from([0xff, 0xfe, 0x00]).toString('base64'),
      },
      {
        name: '未闭合.csv',
        kind: 'vouchers' as const,
        contentBase64: Buffer.from('凭证日期,摘要\n"2026-01-01,未闭合').toString('base64'),
      },
    ];
    const prepared = await api.prepare({ name: '保全错误输入', files });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.files).toHaveLength(2);
    expect(checked.files.every((f) => f.sheets.length === 0)).toBe(true);
    for (const [index, file] of files.entries())
      expect(await api.originalExport({ id: prepared.id, index })).toEqual({
        name: file.name,
        contentBase64: file.contentBase64,
      });
    const foreign = app.call(
      server,
      await app.addUser('foreign-source', { permissions: ['legacy-import.view'] }),
    );
    await expect(foreign.originalExport({ id: prepared.id, index: 0 })).rejects.toThrow(
      '找不到可访问',
    );
    const denied = app.call(server, await app.addUser('no-source', { permissions: [] }));
    await expect(denied.originalExport({ id: prepared.id, index: 0 })).rejects.toThrow();
  });

  it('原文件保存中断时批次及文件同事务回滚，客户端可用相同输入重试', async () => {
    const api = app.call(server);
    const input = {
      name: '保存中断',
      files: [
        {
          name: '科目.csv',
          kind: 'accounts' as const,
          contentBase64: Buffer.from('科目编码,科目名称\n1001,库存现金').toString('base64'),
        },
      ],
    };
    await sql
      .raw(
        `CREATE TRIGGER legacy_import_source_failure BEFORE INSERT ON legacy_import_source BEGIN SELECT RAISE(ABORT, '合成保存中断'); END`,
      )
      .execute(app.svc.db);
    await expect(api.prepare(input)).rejects.toThrow();
    expect(await api.list({})).toEqual([]);
    expect(
      await app.svc.db
        .withTables<ImportTables>()
        .selectFrom('legacy_import_source')
        .selectAll()
        .execute(),
    ).toEqual([]);
    await sql.raw('DROP TRIGGER legacy_import_source_failure').execute(app.svc.db);
    const prepared = await api.prepare(input);
    expect((await api.originalExport({ id: prepared.id, index: 0 })).contentBase64).toBe(
      input.files[0]!.contentBase64,
    );
    expect((await api.preflight({ id: prepared.id })).status).toBe('checked');
  });
});
