import {
  BusinessError,
  formatMoney,
  formatVoucherNo,
  moduleAvailableIn,
  type ModuleManifest,
  type ProductId,
} from '@caiwu/core';
import { pinyinInitials, type CoreServices } from '@caiwu/core/server';
import { sql } from '@caiwu/db';
import { menuEntries, ProductSchema, type Preferences, type SearchResult } from '../shared';
import type { WorkbenchTables } from './migrations';

const forbidden = (message: string) =>
  new BusinessError({
    code: 'FORBIDDEN',
    message,
    hint: '请让管理员授权对应业务模块的读取权限；模块未加载时请先安装该模块',
  });

export function workbenchService(svc: CoreServices, manifests: ModuleManifest[], devMode: boolean) {
  const user = { ...svc.user, permissions: [...svc.user.permissions] };
  const menus = async () => menuEntries(manifests, user, (await svc.book.info()).product, devMode);
  /** W0 没有统一实体权限元数据，只接受对应入口明确声明的 .view 读取权限。 */
  const readable = async (id: string, paths: string[]) => {
    if (svc.user.isAdmin) return true;
    return (await menus()).some(
      (i) =>
        i.moduleId === id &&
        paths.includes(i.path.split('?')[0]!) &&
        i.permission?.endsWith('.view') &&
        svc.permissions.has(i.permission),
    );
  };
  const voucherQuery = async () => {
    const book = await svc.book.info();
    const allowed = manifests
      .filter((m) => (devMode || !m.devOnly) && moduleAvailableIn(m, book.product))
      .flatMap((m) =>
        m.sources
          .filter((s) => {
            const path = s.path.split('?')[0];
            return m.menu.some(
              (i) =>
                i.path.split('?')[0] === path &&
                i.permission?.endsWith('.view') &&
                svc.permissions.has(i.permission),
            );
          })
          .map((s) => ({ module: m.id, type: s.type })),
      );
    let q = svc.db
      .selectFrom('voucher as v')
      .where('v.voided', '=', 0)
      .where('v.status', '!=', 'draft');
    if (!svc.user.isAdmin)
      q = q.where((eb) =>
        eb.or([
          eb('v.source_module', 'is', null),
          ...allowed.map((s) =>
            eb.and([eb('v.source_module', '=', s.module), eb('v.source_type', '=', s.type)]),
          ),
        ]),
      );
    return q;
  };
  return {
    async overview(period?: number) {
      svc.permissions.require('workbench.overview.view');
      if (!(await readable('voucher-book', ['/', '/vouchers'])))
        throw forbidden('没有凭证查询权限，不能查看凭证统计');
      const current = await svc.periods.current();
      const selected = period ? await svc.periods.require(period) : current;
      if (!selected)
        return {
          book: await svc.book.info(),
          current,
          selected: null,
          periods: await svc.periods.list(),
          counts: null,
          scope: '当前用户可读取的凭证；排除草稿、作废',
        };
      const rows = await (
        await voucherQuery()
      )
        .where('v.period', '=', selected.period)
        .select('v.status')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .groupBy('v.status')
        .execute();
      const count = (status: string) => Number(rows.find((r) => r.status === status)?.n ?? 0);
      return {
        book: await svc.book.info(),
        current,
        selected,
        periods: await svc.periods.list(),
        counts: { pending: count('pending'), audited: count('audited'), posted: count('posted') },
        scope: svc.user.isAdmin
          ? '本期间全部凭证；排除草稿、作废'
          : '本期间有来源读取权限的凭证；排除草稿、作废',
      };
    },
    async search(term: string, period: number | undefined, limit: number) {
      svc.permissions.require('workbench.search');
      const book = await svc.book.info();
      const p = period ? await svc.periods.require(period) : await svc.periods.current();
      const entries = await menus();
      const results: SearchResult[] = entries
        .filter((i) =>
          [i.title, pinyinInitials(i.title), ...i.keywords]
            .join(' ')
            .toLowerCase()
            .includes(term.toLowerCase()),
        )
        .slice(0, limit)
        .map((i) => ({
          key: `fn:${i.to}`,
          category: '功能',
          title: i.title,
          detail: `功能 · ${i.group}`,
          to: i.to,
        }));
      const denied: string[] = [];
      const needle = term.toLowerCase();
      // instr 参数化且按字面匹配，%、_、引号不成为通配符或 SQL。
      const contains = (column: string) =>
        sql<boolean>`instr(lower(${sql.ref(column)}), ${needle}) > 0`;
      const targetPeriod = p?.period ?? book.startPeriod;
      const detail = (code: string) =>
        `/m/ledgers/detail?${new URLSearchParams({ account: code, from: String(targetPeriod), to: String(targetPeriod), dims: '' })}`;
      if (await readable('masterdata', ['/accounts'])) {
        const rows = await svc.db
          .selectFrom('account')
          .select(['id', 'code', 'full_name', 'pinyin'])
          .where('disabled', '=', 0)
          .where((eb) => eb.or([contains('code'), contains('full_name'), contains('pinyin')]))
          .orderBy('code')
          .limit(limit)
          .execute();
        results.push(
          ...rows.map((r) => ({
            key: `a:${r.id}`,
            category: '科目' as const,
            title: `${r.code} ${r.full_name}`,
            detail: `编码/名称/拼音 ${r.pinyin}`,
            to: detail(r.code),
          })),
        );
      } else denied.push('科目');
      if (await readable('masterdata', ['/summaries', '/reference'])) {
        const summaryPath = entries.find(
          (i) => i.moduleId === 'masterdata' && ['/summaries', '/reference'].includes(i.path),
        )?.path;
        const rows = await svc.db
          .selectFrom('summary_phrase')
          .selectAll()
          .where((eb) => eb.or([contains('code'), contains('text'), contains('pinyin')]))
          .orderBy('id')
          .limit(limit)
          .execute();
        results.push(
          ...rows.map((r) => ({
            key: `s:${r.id}`,
            category: '摘要' as const,
            title: r.text,
            detail: `${r.code ?? ''} · 拼音 ${r.pinyin}`,
            to: `/m/masterdata${summaryPath ?? '/reference'}?${new URLSearchParams({
              ...(summaryPath === '/summaries' ? {} : { kind: 'summaries' }),
              keyword: r.text,
            })}`,
          })),
        );
      } else denied.push('摘要');
      if (await readable('masterdata', ['/partners', '/dimensions'])) {
        const rows = await svc.db
          .selectFrom('dimension_item')
          .select(['id', 'code', 'name', 'pinyin'])
          .where('type_id', '=', 'partner')
          .where('disabled', '=', 0)
          .where((eb) => eb.or([contains('code'), contains('name'), contains('pinyin')]))
          .orderBy('code')
          .limit(limit)
          .execute();
        results.push(
          ...rows.map((r) => ({
            key: `p:${r.id}`,
            category: '往来单位' as const,
            title: `${r.code} ${r.name}`,
            detail: `客供 · 拼音 ${r.pinyin}`,
            to: `/m/masterdata/dimensions?${new URLSearchParams({ type: 'partner', keyword: r.code })}`,
          })),
        );
      } else denied.push('往来单位');
      if (await readable('voucher-book', ['/', '/vouchers'])) {
        const rows = await (
          await voucherQuery()
        )
          .innerJoin('voucher_type as t', 't.id', 'v.voucher_type_id')
          .select([
            'v.id',
            'v.number',
            'v.voucher_type_id',
            't.code',
            'v.date',
            'v.debit_total',
            'v.period',
          ])
          .where((eb) =>
            eb.or([
              sql<boolean>`instr(lower(${sql.ref('t.code')} || '-' || printf('%04d', ${sql.ref('v.number')})), ${needle}) > 0`,
              eb.exists(
                eb
                  .selectFrom('voucher_line as l')
                  .select('l.id')
                  .whereRef('l.voucher_id', '=', 'v.id')
                  .where(contains('l.summary')),
              ),
            ]),
          )
          .where('v.period', '=', targetPeriod)
          .orderBy('v.id', 'desc')
          .limit(limit)
          .execute();
        results.push(
          ...rows.map((r) => ({
            key: `v:${r.id}:${r.voucher_type_id}`,
            category: '凭证' as const,
            title: formatVoucherNo(r.code, r.number),
            detail: `${r.date} · ${formatMoney(r.debit_total)} · 匹配「${term}」（编号/分录摘要）`,
            to: `/m/voucher-entry/edit?${new URLSearchParams({ id: String(r.id), type: String(r.voucher_type_id), period: String(r.period) })}`,
          })),
        );
      } else denied.push('凭证');
      // 每类别有界，整体上限 30；优先保留每个命中类别。
      const grouped = ['功能', '凭证', '科目', '摘要', '往来单位'].map((c) =>
        results.filter((r) => r.category === c),
      );
      const ordered: SearchResult[] = [];
      for (let i = 0; i < limit; i++)
        for (const group of grouped)
          if (group[i] && ordered.length < limit) ordered.push(group[i]!);
      return { results: ordered, denied, period: p?.period ?? null };
    },
    async preferences(): Promise<Preferences> {
      const row = await svc.db
        .withTables<WorkbenchTables>()
        .selectFrom('workbench_user_preference')
        .selectAll()
        .where('user_id', '=', svc.user.id)
        .executeTakeFirst();
      return {
        favorites: row ? (JSON.parse(row.favorites) as string[]) : [],
        guided: row?.guided === 1,
      };
    },
    async savePreferences(input: Preferences) {
      svc.permissions.require('workbench.settings');
      const allowed = new Set((await menus()).map((i) => i.to));
      const favorites = input.favorites.filter((f) => allowed.has(f));
      await svc.db
        .withTables<WorkbenchTables>()
        .insertInto('workbench_user_preference')
        .values({
          user_id: svc.user.id,
          favorites: JSON.stringify(favorites),
          guided: input.guided ? 1 : 0,
        })
        .onConflict((oc) =>
          oc
            .column('user_id')
            .doUpdateSet({ favorites: JSON.stringify(favorites), guided: input.guided ? 1 : 0 }),
        )
        .execute();
      return { ...input, favorites };
    },
    async switchProduct(raw: { product: ProductId; expectedProduct: ProductId; confirmed: true }) {
      svc.permissions.require('workbench.product.switch');
      const input = ProductSchema.parse(raw);
      return svc.tx(async (tsvc) => {
        tsvc.permissions.require('workbench.product.switch');
        const old = await tsvc.book.info();
        if (old.product !== input.expectedProduct)
          throw new BusinessError({
            code: 'PRODUCT_CHANGED',
            message: '账套产品形态已被其他窗口修改',
            hint: '刷新后确认当前产品，再重新切换',
          });
        await tsvc.db
          .updateTable('book_info')
          .set({ product: input.product, updated_at: tsvc.ctx.now().toISOString() })
          .where('id', '=', 1)
          .execute();
        await tsvc.log.write({
          action: 'workbench.product.switch',
          summary: `产品形态由 ${old.product} 切换为 ${input.product}`,
          targetType: 'book_info',
          targetId: old.id,
        });
        return tsvc.book.info();
      });
    },
  };
}
