import type { BookStore, TemplateRegistry } from '@caiwu/core/server';
import type { ModuleRegistry } from './registry';
import type { SessionStore } from './sessions';

/** 进程级运行环境：所有请求共享。 */
export interface AppRuntime {
  devMode: boolean;
  version: string;
  dataDir: string;
  bookStore: BookStore;
  templates: TemplateRegistry;
  modules: ModuleRegistry;
  sessions: SessionStore;
  now: () => Date;
}

/** 每个请求的上下文。 */
export interface RequestContext {
  app: AppRuntime;
  /** 登录令牌（请求头 Authorization: Bearer <token>） */
  token: string | null;
}
