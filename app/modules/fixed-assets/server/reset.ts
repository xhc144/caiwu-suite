import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '@caiwu/db';
import {
  authenticateUser,
  createCoreServices,
  type CoreDB,
  type CoreServices,
} from '@caiwu/core/server';
import type { AppRuntime, AuthedContext } from '@caiwu/server-kit';
import type { FixedAssetsTables } from './migrations';
import { assetService, fail } from './service';

const tables = [
  'fixed_assets_line',
  'fixed_assets_batch',
  'fixed_assets_work',
  'fixed_assets_adjustment',
  'fixed_assets_transfer',
  'fixed_assets_recalculation',
  'fixed_assets_accessory',
  'fixed_assets_card',
  'fixed_assets_master',
] as const;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const previews = new WeakMap<AppRuntime, Map<string, number>>();
const previewKey = (bookId: string, userId: number, revision: string) =>
  `${bookId}:${userId}:${revision}`;
export async function assetResetPreview(ctx: AuthedContext & { app: AppRuntime }) {
  return ctx.svc.tx(async (svc) => {
    const result = await resetPreview(svc),
      revision = ctx.app.bookStore.revision(ctx.session.bookId),
      expiresAt = Date.now() + 300_000;
    let plans = previews.get(ctx.app);
    if (!plans) previews.set(ctx.app, (plans = new Map()));
    for (const [key, expiry] of plans) if (expiry < Date.now()) plans.delete(key);
    plans.set(previewKey(ctx.session.bookId, ctx.user.id, revision), expiresAt);
    return { ...result, revision, expiresAt };
  });
}

export async function resetPreview(svc: CoreServices) {
  svc.permissions.require('fixed-assets.reset');
  if (!svc.ctx.user.isAdmin) fail('RESET_ADMIN', '只有当前账套管理员可以重置固定资产');
  const db = svc.db.withTables<FixedAssetsTables>();
  const counts = await Promise.all(
    tables.map(async (table) => ({
      table,
      count: Number(
        (
          await db
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      ),
    })),
  );
  const sources = await svc.db
    .selectFrom('voucher')
    .select('id')
    .where('source_module', '=', 'fixed-assets')
    .orderBy('id')
    .execute();
  const vouchers = [];
  for (const source of sources) {
    const v = await svc.vouchers.get(source.id);
    if (!v) fail('RESET_SOURCE', '资产来源凭证已改变，请重新预览');
    if (v.status === 'audited' || v.status === 'posted')
      fail(
        'RESET_AUDITED',
        `${v.date} ${v.displayNo} 已审核或过账，不能清空资产来源`,
        '请保留该账套；只有先按正常流程反过账、取消审核后才能重新预览',
      );
    vouchers.push({ id: v.id, date: v.date, displayNo: v.displayNo, status: v.status });
  }
  const plan = sources.length ? await svc.vouchers.previewDelete(sources.map((v) => v.id)) : null;
  const voucherDeletion = plan
    ? {
        ...plan,
        targets: vouchers.map((v) => ({ id: v.id, date: v.date, displayNo: v.displayNo })),
        impacts: await Promise.all(
          plan.impacts.map(async (impact) => {
            const v = await svc.vouchers.get(impact.id);
            return { ...impact, date: v?.date ?? '', displayNo: v?.displayNo ?? '' };
          }),
        ),
      }
    : null;
  return { book: await svc.book.info(), counts, vouchers, voucherDeletion };
}

export async function protectedAssetReset(
  ctx: AuthedContext & { app: AppRuntime; token: string | null },
  input: {
    revision: string;
    bookName: string;
    password: string;
    confirmText: string;
  },
) {
  const bookId = ctx.session.bookId;
  if (!ctx.token) fail('RESET_LOGIN', '登录已失效，请重新登录');
  const expiry = previews.get(ctx.app)?.get(previewKey(bookId, ctx.user.id, input.revision));
  if (!expiry || expiry <= Date.now())
    fail('RESET_PREVIEW_EXPIRED', '资产重置预览不存在或已超过五分钟', '请重新预览清空范围');
  const preview = await resetPreview(ctx.svc);
  if (input.confirmText !== '清空固定资产' || input.bookName !== preview.book.name)
    fail('RESET_CONFIRM', '请准确输入账套名称及“清空固定资产”');
  if (!(await authenticateUser(ctx.book.db, ctx.user.code, input.password)))
    fail('RESET_PASSWORD', '当前管理员密码错误');
  if (ctx.app.bookStore.revision(bookId) !== input.revision)
    fail('PREVIEW_CHANGED', '账套数据已改变，清空未执行', '请重新预览重置范围');
  // Work on a complete isolated copy. Shared core executes every voucher deletion, including numbering and source checks.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'caiwu-assets-reset-'));
  let replacementId: string;
  try {
    const candidate = path.join(dir, 'candidate.caiwu');
    writeFileSync(candidate, ctx.book.raw.serialize(), { mode: 0o600 });
    const staged = openDatabase<CoreDB>(candidate);
    try {
      const svc = createCoreServices({ ...ctx.svc.ctx, db: staged.db, moduleId: 'fixed-assets' });
      await svc.tx(async (ts) => {
        const tdb = ts.db.withTables<FixedAssetsTables>();
        if (preview.voucherDeletion) {
          const plan = await ts.vouchers.previewDelete(preview.vouchers.map((v) => v.id));
          if (
            JSON.stringify(plan.ids) !== JSON.stringify(preview.voucherDeletion.ids) ||
            JSON.stringify(plan.impacts) !==
              JSON.stringify(
                preview.voucherDeletion.impacts.map(({ id, oldNumber, number }) => ({
                  id,
                  oldNumber,
                  number,
                })),
              )
          )
            fail('PREVIEW_CHANGED', '凭证删除及编号影响已改变', '请重新预览');
          await ts.vouchers.deleteBatch(plan, true);
        }
        for (const table of tables) await tdb.deleteFrom(table).execute();
        await ts.db.deleteFrom('book_setting').where('scope', '=', 'fixed-assets').execute();
        await ts.settings.set('enabled', false);
        await ts.settings.set('voucher', null);
        await assetService(ts).logInternal(
          'reset',
          preview.counts.find((c) => c.table === 'fixed_assets_card')?.count ?? 0,
        );
      });
      const bytes = staged.raw.serialize();
      const ticket = await ctx.app.bookStore.prepareReplacement({
        bookId,
        bytes,
        length: bytes.length,
        sha256: digest(bytes),
        expectedRevision: input.revision,
        expiresAt: Date.now() + 300_000,
      });
      replacementId = ticket.replacementId;
    } finally {
      await staged.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await ctx.app.lifecycle.maintainBook({
    token: ctx.token,
    bookId,
    permission: 'fixed-assets.reset',
    confirmation: { bookId, bookName: input.bookName, password: input.password },
    authorize: async (fresh) => {
      if (ctx.app.bookStore.revision(bookId) !== input.revision)
        fail('PREVIEW_CHANGED', '账套数据已改变，清空未执行', '请重新预览');
      await resetPreview(createCoreServices({ ...fresh.ctx, moduleId: 'fixed-assets' }));
    },
    plan: {
      kind: 'replace',
      replacementId,
      validate: async (book) => {
        for (const table of tables) {
          const result = await book.db
            .withTables<FixedAssetsTables>()
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<number>().as('count'))
            .executeTakeFirstOrThrow();
          if (Number(result.count) !== 0)
            fail('RESET_VERIFY', '资产清空后校验失败，正在恢复保护备份');
        }
        const sources = await book.db
          .selectFrom('voucher')
          .select('id')
          .where('source_module', '=', 'fixed-assets')
          .execute();
        if (sources.length) fail('RESET_VERIFY', '资产来源凭证未完整处理，正在恢复保护备份');
        const protectionId = ctx.app.bookStore.replacementStatus(replacementId).protectionId;
        if (!protectionId) fail('RESET_VERIFY', '缺少完整保护备份编号，正在恢复原账套');
        const fresh = createCoreServices({
          db: book.db,
          user: ctx.user,
          moduleId: 'fixed-assets',
          now: ctx.app.now,
          modules: ctx.app.modules.lookup,
          providers: ctx.app.modules.providers,
        });
        await fresh.settings.set('lastResetProtection', {
          protectionId,
          createdAt: ctx.app.now().toISOString(),
          assetCount: preview.counts.find((c) => c.table === 'fixed_assets_card')?.count ?? 0,
        });
      },
    },
  });
  return { message: '固定资产已重置，完整保护备份已保留，请重新登录当前账套' };
}
