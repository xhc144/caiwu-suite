import { z } from 'zod';
import { MENU_GROUP_IDS } from './menu';
import { PRODUCT_IDS, type ProductId } from './products';

/**
 * 模块清单：每个模块的 `modules/<id>/manifest.ts` 默认导出一个 defineManifest(...)。
 * 前后端共用，不能 import 任何前端或服务端代码。
 */

const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const PermissionSchema = z.object({
  /** 必须以 "<模块id>." 开头，例如 "cashier.document.edit" */
  id: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/),
  name: z.string().min(1),
  description: z.string().optional(),
});

const MenuItemSchema = z.object({
  group: z.enum(MENU_GROUP_IDS),
  title: z.string().min(1),
  /** 模块内路由，以 / 开头。实际地址是 /m/<模块id><path>。 */
  path: z.string().startsWith('/'),
  order: z.number().default(500),
  /** 需要的权限点（必须在 permissions 里声明）。没有权限的用户看不到这个菜单。 */
  permission: z.string().optional(),
  /** 全局快捷键，例如 "Alt+P"、"Ctrl+Shift+V"。 */
  shortcut: z.string().optional(),
  /** 全局搜索用的别名，例如 ["凭证录入", "pzlr"]。 */
  keywords: z.array(z.string()).default([]),
  description: z.string().optional(),
});

const SourceSchema = z.object({
  /** 来源单据类型，模块内唯一，例如 "document" */
  type: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  /** 模块内路由，用 {id} 占位，例如 "/documents?id={id}" */
  path: z.string().startsWith('/').includes('{id}'),
});

export const ManifestSchema = z
  .object({
    id: z.string().regex(MODULE_ID, '模块 id 只能是小写字母、数字和连字符，例如 voucher-entry'),
    name: z.string().min(1),
    description: z.string().optional(),
    /** 属于哪些产品形态；"all" 表示全部。 */
    products: z.union([z.literal('all'), z.array(z.enum(PRODUCT_IDS)).min(1)]),
    /** 只在开发模式显示（示范模块用）。 */
    devOnly: z.boolean().default(false),
    /** 依赖的其它模块（只影响迁移执行顺序和启用检查，不允许 import 对方代码）。 */
    dependsOn: z.array(z.string().regex(MODULE_ID)).default([]),
    permissions: z.array(PermissionSchema).default([]),
    menu: z.array(MenuItemSchema).default([]),
    /** 本模块会生成凭证时，声明来源单据类型和跳转地址，凭证上可以"查看来源"。 */
    sources: z.array(SourceSchema).default([]),
    /**
     * 本模块替换壳自带的入口页面（在 web/index.tsx 的 entryPages 里提供组件）：
     * bookPicker 账套选择页、login 登录页、home 首页/工作台。
     */
    entryPages: z.array(z.enum(['bookPicker', 'login', 'home'])).default([]),
  })
  .superRefine((m, ctx) => {
    const perms = new Set<string>();
    for (const p of m.permissions) {
      if (!p.id.startsWith(`${m.id}.`)) {
        ctx.addIssue({ code: 'custom', message: `权限点 ${p.id} 必须以 "${m.id}." 开头` });
      }
      if (perms.has(p.id)) ctx.addIssue({ code: 'custom', message: `权限点 ${p.id} 重复` });
      perms.add(p.id);
    }
    const paths = new Set<string>();
    for (const item of m.menu) {
      if (item.permission && !perms.has(item.permission)) {
        ctx.addIssue({
          code: 'custom',
          message: `菜单「${item.title}」用到的权限点 ${item.permission} 没有在 permissions 里声明`,
        });
      }
      if (paths.has(item.path))
        ctx.addIssue({ code: 'custom', message: `菜单路径 ${item.path} 重复` });
      paths.add(item.path);
    }
    const types = new Set<string>();
    for (const s of m.sources) {
      if (types.has(s.type))
        ctx.addIssue({ code: 'custom', message: `来源单据类型 ${s.type} 重复` });
      types.add(s.type);
    }
  });

export type ModuleManifestInput = z.input<typeof ManifestSchema>;
export type ModuleManifest = z.output<typeof ManifestSchema>;
export type MenuItem = ModuleManifest['menu'][number];
export type PermissionDef = ModuleManifest['permissions'][number];
export type SourceDef = ModuleManifest['sources'][number];

export function defineManifest(input: ModuleManifestInput): ModuleManifest {
  const result = ManifestSchema.safeParse(input);
  if (!result.success) {
    const id = typeof input.id === 'string' ? input.id : '?';
    throw new Error(
      `模块 ${id} 的 manifest 不合法：\n${result.error.issues.map((i) => `- ${i.path.join('.')} ${i.message}`).join('\n')}`,
    );
  }
  return Object.freeze(result.data);
}

/** 模块页面的完整地址：/m/<模块id><path>。 */
export function moduleRoute(moduleId: string, path = '/'): string {
  return `/m/${moduleId}${path === '/' ? '' : path}`;
}

export function moduleAvailableIn(m: ModuleManifest, product: ProductId): boolean {
  return m.products === 'all' || m.products.includes(product);
}

/** 来源单据的跳转地址；模块没声明该类型时返回 null。 */
export function sourceRoute(m: ModuleManifest, type: string, id: string): string | null {
  const def = m.sources.find((s) => s.type === type);
  return def ? moduleRoute(m.id, def.path.replace('{id}', encodeURIComponent(id))) : null;
}
