import { z } from 'zod';
import {
  PRODUCT_IDS,
  zPeriod,
  moduleAvailableIn,
  moduleRoute,
  type CurrentUser,
  type ModuleManifest,
  type ProductId,
} from '@caiwu/core';

export const OverviewSchema = z.object({ period: zPeriod.optional() }).default({});
export const SearchSchema = z.object({
  term: z.string().trim().min(1).max(64),
  period: zPeriod.optional(),
  limit: z.number().int().min(1).max(30).default(20),
});
export const ProductSchema = z.object({
  product: z.enum(PRODUCT_IDS),
  expectedProduct: z.enum(PRODUCT_IDS),
  confirmed: z.literal(true),
});
export const PreferencesSchema = z.object({
  favorites: z.array(z.string().startsWith('/m/').max(180)).max(30),
  guided: z.boolean(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;
/** 金额单位均为分；收入、成本费用按发生额（不含结转凭证），资金为期末余额（借正贷负）。 */
export type FinanceTotals = { revenue: number; expense: number; profit: number };
export type FinanceMonth = FinanceTotals & { period: number; cash: number };
export type FinanceOverview = {
  period: number | null;
  /** 所选期间所在年度、从启用期间到所选期间的逐月数据 */
  months: FinanceMonth[];
  /** 本年累计（截至所选期间） */
  ytd: FinanceTotals | null;
};
export type SearchResult = {
  key: string;
  category: '功能' | '凭证' | '科目' | '摘要' | '往来单位';
  title: string;
  detail: string;
  to: string;
};

/** w_main1：操作员/账套管理只认身份，用户名不授予权限。 */
export function adminEntry(title: string, path: string) {
  return (
    /用户管理|操作员管理|账套管理|套账管理/.test(title) || /\/(users|books)(\/|$|\?)/.test(path)
  );
}
export function menuEntries(
  manifests: ModuleManifest[],
  user: CurrentUser,
  product: ProductId,
  devMode: boolean,
) {
  return manifests
    .filter((m) => (devMode || !m.devOnly) && moduleAvailableIn(m, product))
    .flatMap((m) =>
      m.menu
        .filter(
          (i) =>
            (!adminEntry(i.title, i.path) || user.isAdmin) &&
            (!i.permission || user.isAdmin || user.permissions.includes(i.permission)),
        )
        .map((i) => ({ ...i, moduleId: m.id, to: moduleRoute(m.id, i.path) })),
    );
}
