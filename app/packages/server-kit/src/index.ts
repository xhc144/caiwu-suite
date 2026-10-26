// @caiwu/server-kit：服务端框架（tRPC 过程、登录会话、模块登记）。只能在服务端使用；
// 前端只能 `import type` 这里的类型（ModuleShell、CoreShell）。
export { t, TRPCError, type ProcedureMeta } from './trpc';
export {
  publicProcedure,
  authedProcedure,
  moduleProcedure,
  type AuthedContext,
} from './procedures';
export { defineServerModule, moduleKit, type ServerModule, type ModuleShell } from './module';
export { ModuleRegistry, listProcedures } from './registry';
export { coreRouter, type CoreRouter, type CoreShell } from './core-router';
export { SessionStore, type Session } from './sessions';
export { createRuntime, buildAppRouter, createCaller, type CreateRuntimeOptions } from './app';
export type { AppRuntime, RequestContext } from './context';
