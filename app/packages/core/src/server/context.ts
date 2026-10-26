import type { Kysely } from '@caiwu/db';
import type { ModuleManifest } from '../manifest';
import type { CoreDB } from './schema';
import type { CoreServiceProviders } from './inventory-provider';
import type { ServiceScope } from './service-scope';

export interface ServiceUser {
  id: number;
  code: string;
  name: string;
  isAdmin: boolean;
  /** 已授予的权限点；管理员拥有全部权限 */
  permissions: ReadonlySet<string>;
}

/** 服务里需要查模块信息（权限点名称、来源单据链接）时用。 */
export interface ModuleLookup {
  manifest(id: string): ModuleManifest | undefined;
  permissionName(permission: string): string | undefined;
}

export const emptyModuleLookup: ModuleLookup = {
  manifest: () => undefined,
  permissionName: () => undefined,
};

/**
 * 服务上下文。每个请求一个：当前账套的数据库、当前操作员、当前调用的模块。
 * moduleId 为 null 表示核心或手工操作（例如凭证录入）。
 */
export interface ServiceContext {
  db: Kysely<CoreDB>;
  user: ServiceUser;
  moduleId: string | null;
  now: () => Date;
  modules: ModuleLookup;
  providers?: CoreServiceProviders;
  scope?: ServiceScope;
}

export function nowIso(ctx: Pick<ServiceContext, 'now'>): string {
  return ctx.now().toISOString();
}
