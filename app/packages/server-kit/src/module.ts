import type { AnyTRPCRouter } from '@trpc/server';
import type { Migration } from '@caiwu/db';
import type { CreateBookInput, ModuleManifest } from '@caiwu/core';
import type { CoreServiceProviders } from '@caiwu/core/server';
import { moduleProcedure } from './procedures';
import { t } from './trpc';
import type { RuntimeHooks } from './lifecycle';

/** 模块服务端的定义：modules/<id>/server/index.ts 默认导出 defineServerModule(...)。 */
export interface ServerModule<R extends AnyTRPCRouter = AnyTRPCRouter> {
  manifest: ModuleManifest;
  router: R;
  /** 模块自己的迁移（表名用模块前缀） */
  migrations: readonly Migration[];
  /** 模块提供的会计制度模板（JSON 对象） */
  templates: readonly unknown[];
  /** 本模块静态模板的新建前校验；运行时登记的模板须同时登记其校验。 */
  validateBookCreation?: (input: CreateBookInput) => void;
  lifecycle?: RuntimeHooks;
  providers?: CoreServiceProviders;
}

export function defineServerModule<R extends AnyTRPCRouter>(
  manifest: ModuleManifest,
  def: {
    router: R;
    migrations?: readonly Migration[];
    templates?: readonly unknown[];
    validateBookCreation?: (input: CreateBookInput) => void;
    lifecycle?: RuntimeHooks;
    providers?: CoreServiceProviders;
  },
): ServerModule<R> {
  return Object.freeze({
    manifest,
    router: def.router,
    migrations: def.migrations ?? [],
    templates: def.templates ?? [],
    validateBookCreation: def.validateBookCreation,
    lifecycle: def.lifecycle,
    providers: def.providers,
  });
}

/**
 * 模块写 router 用的工具：
 *
 *   const m = moduleKit(manifest);
 *   export const exampleRouter = m.router({
 *     list: m.procedure.query(({ ctx }) => ...),
 *     save: m.procedure.meta({ permission: 'example.memo.edit' }).input(schema).mutation(...),
 *   });
 *
 * ctx.svc 是绑定到本模块的核心服务，ctx.db 等同 ctx.svc.db。
 */
export function moduleKit(manifest: ModuleManifest) {
  return {
    router: t.router,
    procedure: moduleProcedure(manifest.id),
    manifest,
  };
}

/** 类型工具：把模块 router 包成和应用 router 一样的路径形状（m.<模块id>.*），前端据此获得类型。 */
function _moduleShell<K extends string, R extends AnyTRPCRouter>(key: K, router: R) {
  return t.router({ m: t.router({ [key]: router } as { [P in K]: R }) });
}
export type ModuleShell<K extends string, R extends AnyTRPCRouter> = ReturnType<
  typeof _moduleShell<K, R>
>;
