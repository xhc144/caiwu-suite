import type { AnyTRPCRouter } from '@trpc/server';
import { BookStore, TemplateRegistry, builtinTemplates } from '@caiwu/core/server';
import { coreRouter } from './core-router';
import { ModuleRegistry } from './registry';
import { SessionStore } from './sessions';
import { t } from './trpc';
import type { AppRuntime, RequestContext } from './context';
import type { ServerModule } from './module';

export interface CreateRuntimeOptions {
  dataDir: string;
  modules: readonly ServerModule[];
  /** modules[i] 应该在的目录名，用于检查 id 与目录一致 */
  moduleDirs?: readonly string[];
  devMode?: boolean;
  version?: string;
  now?: () => Date;
}

/** 组装运行环境：模块登记、模板登记、账套存储、会话。 */
export function createRuntime(opts: CreateRuntimeOptions): AppRuntime {
  const modules = new ModuleRegistry(opts.modules, {
    expectedIds: opts.moduleDirs
      ? Object.fromEntries(opts.moduleDirs.map((d, i) => [i, d]))
      : undefined,
  });
  const devMode = opts.devMode ?? false;
  const templates = new TemplateRegistry({ devMode });
  templates.register('core', builtinTemplates);
  for (const { source, templates: list } of modules.templates()) templates.register(source, list);
  const bookStore = new BookStore({
    dataDir: opts.dataDir,
    templates,
    modules: modules.lookup,
    migrationSets: () => modules.migrationSets(),
    now: opts.now,
  });
  return {
    devMode,
    version: opts.version ?? '0.0.0',
    dataDir: opts.dataDir,
    bookStore,
    templates,
    modules,
    sessions: new SessionStore(),
    now: opts.now ?? (() => new Date()),
  };
}

/** 应用 router：core.* + m.<模块id>.* */
export function buildAppRouter(runtime: AppRuntime): AnyTRPCRouter {
  const moduleRouters = Object.fromEntries(
    runtime.modules.modules.map((m) => [m.manifest.id, m.router]),
  );
  return t.router({ core: coreRouter, m: t.router(moduleRouters) });
}

/** 服务端直接调用 router（测试用）。 */
export function createCaller(router: AnyTRPCRouter, ctx: RequestContext) {
  return t.createCallerFactory(router)(ctx);
}
