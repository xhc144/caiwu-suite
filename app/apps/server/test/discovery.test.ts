import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { ServerModule } from '@caiwu/server-kit';
import { createTestApp } from '@caiwu/testkit';
// @ts-expect-error 生成脚本是 .mjs，没有类型声明
import { generate } from '../../../scripts/gen-modules.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const probeId = `_probe${process.pid}`;
const probeDir = path.join(appRoot, 'modules', probeId);
const outFile = path.join(appRoot, '.generated', `${probeId}.ts`);

afterAll(() => {
  rmSync(probeDir, { recursive: true, force: true });
  rmSync(outFile, { force: true });
});

describe('模块自动发现', () => {
  it('新建一个模块目录（只放 manifest + server），不改任何共享文件就能注册、建表、调用', async () => {
    const id = probeId.replace(/^_/, '').toLowerCase();
    mkdirSync(path.join(probeDir, 'server'), { recursive: true });
    writeFileSync(
      path.join(probeDir, 'manifest.ts'),
      `import { defineManifest } from '@caiwu/core';
export default defineManifest({ id: '${id}', name: '探针', products: 'all', menu: [{ group: 'dev', title: '探针', path: '/' }] });`,
    );
    writeFileSync(
      path.join(probeDir, 'server', 'index.ts'),
      `import { defineMigrations } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
const m = moduleKit(manifest);
export default defineServerModule(manifest, {
  router: m.router({ ping: m.procedure.query(async ({ ctx }) => {
    const db = ctx.svc.db.withTables<{ ${id}_t: { id: number } }>();
    return (await db.selectFrom('${id}_t').selectAll().execute()).length;
  }) }),
  migrations: defineMigrations([{ id: '0001_init', sql: 'CREATE TABLE ${id}_t (id INTEGER)' }]),
});`,
    );
    const { modules } = generate({ outFile, includeUnderscore: true });
    expect(modules.map((m: { id: string }) => m.id)).toContain(probeId);
    const { serverModules: mods } = (await import(/* @vite-ignore */ outFile)) as {
      serverModules: ServerModule[];
    };
    const probe = mods.find((m) => m.manifest.id === id)!;
    expect(probe).toBeTruthy();
    const app = await createTestApp({ modules: mods });
    try {
      expect(await (app.call(probe) as unknown as { ping: () => Promise<number> }).ping()).toBe(0);
    } finally {
      await app.close();
    }
  });
});
