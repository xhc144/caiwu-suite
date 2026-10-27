import type { AnyTRPCRouter } from '@trpc/server';
import { orderByDependencies, type MigrationSet } from '@caiwu/db';
import type { ModuleManifest } from '@caiwu/core';
import type { CoreServiceProviders, ModuleLookup } from '@caiwu/core/server';
import type { ServerModule } from './module';

interface ProcedureDefLike {
  _def: {
    type: 'query' | 'mutation' | 'subscription';
    meta?: { permission?: string; noPermission?: boolean };
  };
}

/** 列出 router 里的全部过程（扁平路径）。 */
export function listProcedures(
  router: AnyTRPCRouter,
): { path: string; type: string; meta: ProcedureDefLike['_def']['meta'] }[] {
  const procs = (router._def as unknown as { procedures: Record<string, ProcedureDefLike> })
    .procedures;
  return Object.entries(procs).map(([path, p]) => ({ path, type: p._def.type, meta: p._def.meta }));
}

/**
 * 已加载模块的登记处：检查 id 唯一、依赖存在、权限点声明一致，
 * 并提供迁移顺序、模块查询、模板列表。
 */
export class ModuleRegistry {
  readonly modules: readonly ServerModule[];
  readonly lookup: ModuleLookup;
  readonly providers: CoreServiceProviders;

  constructor(
    modules: readonly ServerModule[],
    opts: { expectedIds?: Record<number, string> } = {},
  ) {
    const ids = new Set<string>();
    const dimensionReferences: NonNullable<CoreServiceProviders['dimensionReferences']>[number][] =
      [];
    const periodDependencies: NonNullable<CoreServiceProviders['periodDependencies']>[number][] =
      [];
    const providers: { inventory?: CoreServiceProviders['inventory'] } = {};
    modules.forEach((m, i) => {
      const expected = opts.expectedIds?.[i];
      if (expected && expected !== m.manifest.id) {
        throw new Error(
          `modules/${expected} 目录里的模块 id 是 "${m.manifest.id}"，必须和目录名一致`,
        );
      }
      if (ids.has(m.manifest.id)) throw new Error(`模块 id "${m.manifest.id}" 重复`);
      ids.add(m.manifest.id);
      validateRouter(m);
      dimensionReferences.push(...(m.providers?.dimensionReferences ?? []));
      periodDependencies.push(...(m.providers?.periodDependencies ?? []));
      if (m.providers?.inventory) {
        if (m.manifest.id !== 'inventory') throw new Error('只有库存模块可以注册库存成本服务');
        if (typeof m.providers.inventory !== 'function')
          throw new Error('库存成本服务必须注册无状态工厂');
        providers.inventory = m.providers.inventory;
      }
      for (const mig of m.migrations) {
        if (!new RegExp(`(?:CREATE TABLE|ALTER TABLE)`, 'i').test(mig.sql)) continue;
        const prefix = m.manifest.id.replace(/-/g, '_');
        for (const match of mig.sql.matchAll(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/gi,
        )) {
          if (!match[1]!.startsWith(`${prefix}_`)) {
            throw new Error(
              `模块 ${m.manifest.id} 的迁移 ${mig.id} 建了表 ${match[1]}，表名必须以 "${prefix}_" 开头`,
            );
          }
        }
      }
    });
    this.providers = Object.freeze({ ...providers, dimensionReferences, periodDependencies });
    const ordered = orderByDependencies(
      modules.map((m) => ({ id: m.manifest.id, dependsOn: m.manifest.dependsOn, m })),
    );
    this.modules = Object.freeze(ordered.map((o) => o.m));
    const byId = new Map(this.modules.map((m) => [m.manifest.id, m.manifest]));
    const permNames = new Map<string, string>();
    for (const m of this.modules)
      for (const p of m.manifest.permissions) permNames.set(p.id, `${m.manifest.name}·${p.name}`);
    this.lookup = {
      manifest: (id) => byId.get(id),
      permissionName: (perm) => permNames.get(perm),
    };
  }

  manifests(): ModuleManifest[] {
    return this.modules.map((m) => m.manifest);
  }

  /** 迁移执行顺序：按模块依赖拓扑排序（core 由 BookStore 自动放在最前）。 */
  migrationSets(): MigrationSet[] {
    return this.modules
      .filter((m) => m.migrations.length)
      .map((m) => ({ scope: m.manifest.id, migrations: m.migrations }));
  }

  templates(): { source: string; templates: readonly unknown[] }[] {
    return this.modules
      .filter((m) => m.templates.length)
      .map((m) => ({ source: m.manifest.id, templates: m.templates }));
  }
}

function validateRouter(m: ServerModule) {
  const declared = new Set(m.manifest.permissions.map((p) => p.id));
  for (const p of listProcedures(m.router)) {
    const where = `模块 ${m.manifest.id} 的接口 ${p.path}`;
    if (p.meta?.permission && !declared.has(p.meta.permission)) {
      throw new Error(
        `${where} 用到的权限点 ${p.meta.permission} 没有在 manifest.permissions 里声明`,
      );
    }
    if (p.type === 'mutation' && !p.meta?.permission && !p.meta?.noPermission) {
      throw new Error(
        `${where} 是修改数据的接口，必须声明权限：.meta({ permission: '${m.manifest.id}.xxx' })；确实不需要权限的写 .meta({ noPermission: true })`,
      );
    }
  }
}
