import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { defineManifest } from '@caiwu/core';
import type { CoreDB } from '@caiwu/core/server';
import { defineMigrations, openDatabase } from '@caiwu/db';
import { defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createServer } from '../src';

it('w_hf：真实 HTTP 管理员确认接通共享覆盖链，全部旧连接和会话撤销，重登回到备份业务值且保护副本含当前值', async () => {
  const manifest = defineManifest({
    id: 'restore-http',
    name: '合成覆盖 HTTP',
    products: 'all',
    permissions: [{ id: 'restore-http.restore', name: '恢复' }],
  });
  const kit = moduleKit(manifest);
  const module = defineServerModule(manifest, {
    migrations: defineMigrations([
      {
        id: '0001_data',
        sql: "CREATE TABLE restore_http_data(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO restore_http_data VALUES(1,'备份业务值')",
      },
    ]),
    router: kit.router({
      restore: kit.procedure
        .meta({ permission: 'restore-http.restore' })
        .input(z.object({ replacementId: z.string(), bookName: z.string(), password: z.string() }))
        .mutation(async ({ ctx, input }) => {
          await ctx.app.lifecycle.maintainBook({
            token: ctx.session.token,
            bookId: ctx.book.id,
            permission: 'restore-http.restore',
            confirmation: {
              bookId: ctx.book.id,
              bookName: input.bookName,
              password: input.password,
            },
            authorize: async () => {},
            plan: { kind: 'replace', replacementId: input.replacementId },
          });
          // 返回只读票据结果；维护升级后不可再用旧 ctx.svc 写结果。
          return ctx.app.bookStore.replacementStatus(input.replacementId);
        }),
    }),
  });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-restore-http-'));
  const server = await createServer({
    dataDir,
    token: 'synthetic-startup',
    modules: [module],
    devMode: true,
  });
  const post = (method: string, payload: Record<string, unknown>, token?: string) =>
    server.fastify.inject({
      method: 'POST',
      url: `/trpc/${method}`,
      payload,
      headers: {
        host: '127.0.0.1',
        'x-caiwu-token': 'synthetic-startup',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  const me = (token: string) =>
    server.fastify.inject({
      url: '/trpc/core.auth.me',
      headers: {
        host: '127.0.0.1',
        'x-caiwu-token': 'synthetic-startup',
        authorization: `Bearer ${token}`,
      },
    });
  try {
    const created = await post('core.books.create', {
      name: 'HTTP合成账套',
      orgName: '合成单位',
      templateId: 'demo-enterprise',
      product: 'qingsong',
      startYear: 2026,
      startMonth: 1,
      adminPassword: 'synthetic-password',
    });
    expect(created.statusCode).toBe(200);
    const bookId = created.json().result.data.id as string;
    const login = () =>
      post('core.auth.login', { bookId, userCode: 'admin', password: 'synthetic-password' });
    const token = (await login()).json().result.data.token as string;
    const otherToken = (await login()).json().result.data.token as string;
    const store = server.runtime.bookStore;
    const original = store.open(bookId);
    const bytes = original.raw.serialize();
    original.raw.prepare("UPDATE restore_http_data SET value='覆盖前当前业务值' WHERE id=1").run();
    const ticket = await store.prepareReplacement({
      bookId,
      sourceBookId: bookId,
      bytes,
      length: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      expectedRevision: store.revision(bookId),
      expiresAt: Date.now() + 60_000,
    });
    const extra = openDatabase<CoreDB>(original.file);
    try {
      await extra.db.selectFrom('book_info').selectAll().execute();
      const input = {
        replacementId: ticket.replacementId,
        bookName: 'HTTP合成账套',
        password: 'synthetic-password',
      };
      const denied = await post('m.restore-http.restore', { ...input, password: '错误' }, token);
      expect(denied.json().error.data.business.code).toBe('RESTORE_CONFIRM_FAILED');
      expect((await me(token)).statusCode).toBe(200);
      const response = await post('m.restore-http.restore', input, token);
      expect(response.statusCode).toBe(200);
      expect(response.json().result.data).toMatchObject({
        bookId,
        status: 'done',
        relogin: true,
        protectionId: expect.any(String),
      });
      expect(original.raw.open).toBe(false);
      expect(extra.raw.open).toBe(false);
      await expect(original.db.selectFrom('book_info').selectAll().execute()).rejects.toThrow();
      expect((await me(token)).statusCode).toBe(401);
      expect((await me(otherToken)).statusCode).toBe(401);
      const renewed = await login();
      expect(renewed.statusCode).toBe(200);
      expect((await me(renewed.json().result.data.token as string)).statusCode).toBe(200);
      const restored = store.open(bookId).raw;
      expect(restored.prepare('SELECT value FROM restore_http_data WHERE id=1').pluck().get()).toBe(
        '备份业务值',
      );
      const protection = path.join(
        dataDir,
        'core-protection',
        bookId,
        `${response.json().result.data.protectionId}.caiwu`,
      );
      const backup = new Database(protection, { readonly: true, fileMustExist: true });
      try {
        expect(backup.prepare('SELECT value FROM restore_http_data WHERE id=1').pluck().get()).toBe(
          '覆盖前当前业务值',
        );
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
      } finally {
        backup.close();
      }
      expect(existsSync(path.join(dataDir, '.caiwu-runtime.lock', 'maintenance.json'))).toBe(false);
    } finally {
      if (extra.raw.open) await extra.close();
    }
  } finally {
    await server.fastify.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
