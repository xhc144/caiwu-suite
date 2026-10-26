#!/usr/bin/env node
// 扫描 modules/*/，生成服务端模块注册文件 .generated/server-modules.ts。
// 生成文件已在 .gitignore 里，dev / typecheck / test / build 之前会自动运行，不需要手动执行，也不要提交。
// 前端不需要生成：apps/web 用 import.meta.glob 直接发现 modules/*/manifest.ts 和 modules/*/web/index.tsx。
//
// 约定：
//   modules/<id>/manifest.ts        必须有，默认导出 defineManifest({...})，id 必须等于目录名
//   modules/<id>/server/index.ts    可选，默认导出 defineServerModule(...)
//   modules/<id>/web/index.tsx      可选，默认导出 defineWebModule(...)
// 以 _ 或 . 开头的目录会被忽略。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function discoverModules(
  modulesDir = path.join(appRoot, 'modules'),
  { includeUnderscore = false } = {},
) {
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir)
    .filter((name) => !name.startsWith('.') && (includeUnderscore || !name.startsWith('_')))
    .filter((name) => statSync(path.join(modulesDir, name)).isDirectory())
    .sort()
    .map((name) => {
      const dir = path.join(modulesDir, name);
      if (!existsSync(path.join(dir, 'manifest.ts'))) {
        throw new Error(`modules/${name} 缺少 manifest.ts（每个模块目录都必须有）`);
      }
      return {
        id: name,
        dir,
        hasServer: existsSync(path.join(dir, 'server', 'index.ts')),
        hasWeb: existsSync(path.join(dir, 'web', 'index.tsx')),
      };
    });
}

export function renderServerRegistry(modules, outFile) {
  const rel = (p) => {
    const r = path.relative(path.dirname(outFile), p).split(path.sep).join('/');
    return r.startsWith('.') ? r : `./${r}`;
  };
  const withServer = modules.filter((m) => m.hasServer);
  const lines = [
    '// 自动生成（scripts/gen-modules.mjs），不要手改，也不要提交。',
    "import type { ServerModule } from '@caiwu/server-kit';",
    ...withServer.map((m, i) => `import m${i} from '${rel(path.join(m.dir, 'server', 'index'))}';`),
    '',
    `export const serverModules: ServerModule[] = [${withServer.map((_, i) => `m${i}`).join(', ')}];`,
    `export const serverModuleDirs: string[] = ${JSON.stringify(withServer.map((m) => m.id))};`,
    '',
  ];
  return lines.join('\n');
}

export function generate({
  modulesDir,
  outFile = path.join(appRoot, '.generated', 'server-modules.ts'),
  includeUnderscore,
} = {}) {
  const modules = discoverModules(modulesDir, { includeUnderscore });
  const content = renderServerRegistry(modules, outFile);
  mkdirSync(path.dirname(outFile), { recursive: true });
  const old = existsSync(outFile) ? readFileSync(outFile, 'utf8') : null;
  if (old !== content) writeFileSync(outFile, content);
  return { modules, outFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { modules } = generate();
  console.log(`[gen] ${modules.length} 个模块：${modules.map((m) => m.id).join(', ') || '（无）'}`);
}
