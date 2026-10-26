import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type CaiwuServer } from '../src';
import exampleServer from '../../../modules/example/server';

const dirs: string[] = [];
let server: CaiwuServer | null = null;
afterEach(async () => {
  await server?.fastify.close();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(withWeb = false) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-srv-'));
  dirs.push(dataDir);
  let webDist: string | undefined;
  if (withWeb) {
    webDist = path.join(dataDir, 'web');
    mkdirSync(webDist);
    writeFileSync(path.join(webDist, 'index.html'), '<html><head></head><body>app</body></html>');
    writeFileSync(path.join(webDist, 'app.js'), 'console.log(1)');
  }
  server = await createServer({
    dataDir,
    token: 'tok',
    modules: [exampleServer],
    devMode: true,
    webDist,
  });
  return server.fastify;
}

const headers = {
  host: '127.0.0.1:3000',
  'x-caiwu-token': 'tok',
  'content-type': 'application/json',
};

describe('本地服务', () => {
  it('拒绝非本机 Host 和缺少启动令牌的请求', async () => {
    const f = await start();
    expect(
      (await f.inject({ url: '/healthz', headers: { host: 'evil.example.com' } })).statusCode,
    ).toBe(403);
    expect(
      (await f.inject({ url: '/trpc/core.bootstrap', headers: { host: 'localhost:1' } }))
        .statusCode,
    ).toBe(401);
    const ok = await f.inject({ url: '/trpc/core.bootstrap', headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result.data.devMode).toBe(true);
  });

  it('新建账套、登录、调用模块接口；业务错误带 business 数据', async () => {
    const f = await start();
    const create = await f.inject({
      method: 'POST',
      url: '/trpc/core.books.create',
      headers,
      payload: {
        name: '甲',
        orgName: '甲公司',
        templateId: 'demo-enterprise',
        product: 'qingsong',
        startYear: 2026,
        startMonth: 1,
        adminPassword: '1',
      },
    });
    expect(create.statusCode).toBe(200);
    const bookId = create.json().result.data.id as string;
    const bad = await f.inject({
      method: 'POST',
      url: '/trpc/core.auth.login',
      headers,
      payload: { bookId, userCode: 'admin', password: 'x' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.data.business).toMatchObject({
      code: 'LOGIN_FAILED',
      message: '用户编号或密码不对',
    });
    const login = await f.inject({
      method: 'POST',
      url: '/trpc/core.auth.login',
      headers,
      payload: { bookId, userCode: 'admin', password: '1' },
    });
    const token = login.json().result.data.token as string;
    const authed = { ...headers, authorization: `Bearer ${token}` };
    const list = await f.inject({
      url: `/trpc/m.example.memos.list?input=${encodeURIComponent('{}')}`,
      headers: authed,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().result.data).toEqual([]);
    const invalid = await f.inject({
      method: 'POST',
      url: '/trpc/m.example.memos.create',
      headers: authed,
      payload: { date: 'x' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.data.business.code).toBe('INPUT_INVALID');
    expect(invalid.json().error.data.business.message).toMatch(/提交的数据不合法/);
  });

  it('提供网页：首页注入启动令牌，前端路由刷新返回首页，静态文件照常返回', async () => {
    const f = await start(true);
    const index = await f.inject({ url: '/', headers: { host: 'localhost:9' } });
    expect(index.body).toContain('window.__CAIWU_BOOT__={"token":"tok"}');
    const deep = await f.inject({ url: '/m/example/memos?id=1', headers: { host: 'localhost:9' } });
    expect(deep.body).toContain('__CAIWU_BOOT__');
    const js = await f.inject({ url: '/app.js', headers: { host: 'localhost:9' } });
    expect(js.body).toBe('console.log(1)');
    expect(
      (await f.inject({ url: '/missing.js', headers: { host: 'localhost:9' } })).statusCode,
    ).toBe(404);
  });
});
