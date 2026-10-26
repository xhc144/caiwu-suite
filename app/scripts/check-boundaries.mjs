#!/usr/bin/env node
// 架构边界检查（pnpm lint 的一部分）。规则：
//  1. 模块之间不许互相 import（modules/a 不能引用 modules/b 的任何文件），也不许引用 apps/*
//  2. packages/* 不许引用 modules/* 和 apps/*
//  3. 前端代码（apps/web、packages/ui|web-kit|print、modules/*/web、manifest.ts、shared.ts）
//     不许引用服务端代码：@caiwu/db、@caiwu/core/server、@caiwu/testkit、node:*、better-sqlite3、fastify、kysely；
//     @caiwu/server-kit 和本模块 ../server/ 只能 `import type`
//  4. 服务端代码（apps/server、packages/db|server-kit|core/src/server、modules/*/server）不许引用 react、antd、前端包
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(appRoot, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE =
  /^\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;

function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[3] ?? m[4];
    const line = text.slice(0, m.index).split('\n').length;
    out.push({ spec, typeOnly: !!m[2], line });
  }
  return out;
}

function kindOf(r) {
  if (/(^|\/)(test|e2e)\//.test(r) || /\.(test|spec)\.tsx?$/.test(r)) return 'test';
  if (
    r.startsWith('apps/web/') ||
    /^packages\/(ui|web-kit|print)\//.test(r) ||
    /^modules\/[^/]+\/web\//.test(r)
  )
    return 'browser';
  if (/^modules\/[^/]+\/(manifest|shared)\.ts$/.test(r)) return 'shared';
  if (
    r.startsWith('apps/server/') ||
    r.startsWith('apps/desktop/') ||
    /^packages\/(db|server-kit|testkit)\//.test(r) ||
    r.startsWith('packages/core/src/server/') ||
    /^modules\/[^/]+\/server\//.test(r)
  )
    return 'server';
  if (r.startsWith('packages/core/src/')) return 'shared';
  return 'other';
}

const SERVER_ONLY = [
  /^@caiwu\/db$/,
  /^@caiwu\/core\/server$/,
  /^@caiwu\/testkit/,
  /^node:/,
  /^better-sqlite3$/,
  /^fastify/,
  /^@fastify\//,
  /^kysely$/,
  /^electron$/,
];
const TYPE_ONLY_FROM_BROWSER = [/^@caiwu\/server-kit$/, /^@trpc\/server$/];
const BROWSER_ONLY = [
  /^react(-dom)?(\/|$)/,
  /^antd/,
  /^@ant-design\//,
  /^@caiwu\/(ui|web-kit|print)$/,
  /^@tanstack\/react/,
  /^react-router/,
];

const violations = [];
for (const file of walk(appRoot)) {
  const r = rel(file);
  if (r.startsWith('scripts/') || /^[^/]+\.(ts|mjs)$/.test(r)) continue;
  const kind = kindOf(r);
  const ownModule = /^modules\/([^/]+)\//.exec(r)?.[1];
  for (const imp of importsOf(file)) {
    const target = imp.spec.startsWith('.')
      ? rel(path.resolve(path.dirname(file), imp.spec))
      : null;
    const add = (msg) => violations.push(`${r}:${imp.line}  ${msg}（import '${imp.spec}'）`);

    if (target) {
      const targetModule = /^modules\/([^/]+)/.exec(target)?.[1];
      if (ownModule && targetModule && targetModule !== ownModule)
        add(
          `模块 ${ownModule} 不能引用模块 ${targetModule} 的代码，模块之间只能通过 core 服务和路由交互`,
        );
      if (
        r.startsWith('packages/') &&
        (target.startsWith('modules/') || target.startsWith('apps/'))
      )
        add('packages 不能引用 modules 或 apps');
      if (ownModule && target.startsWith('apps/')) add('模块不能引用 apps 里的代码');
    }
    if (kind === 'browser' || kind === 'shared') {
      if (SERVER_ONLY.some((re) => re.test(imp.spec))) add('前端代码不能引用服务端代码');
      if (!imp.typeOnly && TYPE_ONLY_FROM_BROWSER.some((re) => re.test(imp.spec)))
        add('前端只能 import type 服务端框架的类型');
      if (!imp.typeOnly && target && /^modules\/[^/]+\/server\//.test(target))
        add('前端只能 import type 本模块 server 目录的类型（例如 router 类型）');
    }
    if (kind === 'shared' && BROWSER_ONLY.some((re) => re.test(imp.spec)))
      add('前后端共用的代码不能引用前端库');
    if (kind === 'server') {
      if (BROWSER_ONLY.some((re) => re.test(imp.spec))) add('服务端代码不能引用前端库');
      if (target && /^modules\/[^/]+\/web\//.test(target)) add('服务端代码不能引用模块的 web 目录');
    }
  }
}

if (violations.length) {
  console.error(
    `架构边界检查发现 ${violations.length} 处问题：\n${violations.map((v) => `  ${v}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('[boundaries] 通过');
