import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { BusinessError } from '@caiwu/core';
import { z } from 'zod';
import type { AppRuntime, AuthedContext } from '@caiwu/server-kit';
import { fail } from './service';

type Context = AuthedContext & { app: AppRuntime; token: string | null };
type Protection = { protectionId: string; createdAt: string; assetCount: number };
type Plan = {
  bookId: string;
  userId: number;
  revision: string;
  expiresAt: number;
  cardCount: number;
};
const plans = new WeakMap<AppRuntime, Map<string, Plan>>();
async function assertCurrentSourcesUnreviewed(ctx: Context) {
  const source = await ctx.svc.db
    .selectFrom('voucher')
    .select('id')
    .where('source_module', '=', 'fixed-assets')
    .where('status', 'in', ['audited', 'posted'])
    .executeTakeFirst();
  if (source)
    fail(
      'RESET_AUDITED',
      '当前账套已有审核或过账的资产来源凭证，不能覆盖恢复',
      '请保留现有账套，按正常流程处理来源凭证',
    );
}
export async function resetProtectionInfo(ctx: Context) {
  ctx.svc.permissions.require('fixed-assets.reset');
  if (!ctx.user.isAdmin) fail('RESET_ADMIN', '只有当前账套管理员可以恢复重置前数据');
  return ctx.svc.settings.get<Protection | null>('lastResetProtection', null);
}
export async function previewResetRestore(ctx: Context) {
  try {
    return await prepareResetRestore(ctx);
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    fail(
      'RESET_PROTECTION_READ',
      '无法读取重置保护备份，当前账套保留',
      '请检查保护备份文件及存储位置后重新预览',
    );
  }
}
async function prepareResetRestore(ctx: Context) {
  const protection = await resetProtectionInfo(ctx);
  await assertCurrentSourcesUnreviewed(ctx);
  if (!protection || !/^[0-9a-f-]{36}$/i.test(protection.protectionId))
    fail('RESET_PROTECTION_MISSING', '当前账套没有可用的资产重置保护备份');
  const bookId = ctx.session.bookId,
    root = path.join(ctx.app.dataDir, 'core-protection'),
    directory = path.join(root, bookId),
    file = path.join(directory, `${protection.protectionId}.caiwu`),
    meta = `${file}.json`;
  for (const parent of [root, directory]) {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail('RESET_PROTECTION_PATH', '保护备份目录不安全，不能恢复');
  }
  for (const target of [file, meta]) {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 ** 3)
      fail('RESET_PROTECTION_PATH', '保护备份不是受管普通文件，不能恢复');
  }
  const metadata = z
    .object({
      bookId: z.uuid(),
      length: z
        .number()
        .int()
        .positive()
        .max(1024 ** 3),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      createdAt: z.string().min(1).max(100),
    })
    .parse(JSON.parse(readFileSync(meta, 'utf8')));
  const bytes = readFileSync(file),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  if (metadata.bookId !== bookId || metadata.length !== bytes.length || metadata.sha256 !== sha256)
    fail('RESET_PROTECTION_DIGEST', '保护备份内容与完整性记录不符，原账套保留');
  const source = new Database(file, { readonly: true, fileMustExist: true });
  let cardCount: number;
  try {
    cardCount = (
      source.prepare('SELECT COUNT(*) AS count FROM fixed_assets_card').get() as { count: number }
    ).count;
  } finally {
    source.close();
  }
  const revision = ctx.app.bookStore.revision(bookId),
    expiresAt = Date.now() + 300_000;
  const ticket = await ctx.app.bookStore.prepareReplacement({
    bookId,
    bytes,
    length: bytes.length,
    sha256,
    expectedRevision: revision,
    expiresAt,
  });
  let current = plans.get(ctx.app);
  if (!current) plans.set(ctx.app, (current = new Map()));
  for (const [id, plan] of current) if (plan.expiresAt <= Date.now()) current.delete(id);
  current.set(ticket.replacementId, {
    bookId,
    userId: ctx.user.id,
    revision,
    expiresAt,
    cardCount,
  });
  return {
    replacementId: ticket.replacementId,
    bookName: (await ctx.svc.book.info()).name,
    expiresAt,
    createdAt: metadata.createdAt,
    cardCount,
  };
}
export async function restoreBeforeReset(
  ctx: Context,
  input: { replacementId: string; bookName: string; password: string; confirmText: string },
) {
  await resetProtectionInfo(ctx);
  await assertCurrentSourcesUnreviewed(ctx);
  const plan = plans.get(ctx.app)?.get(input.replacementId);
  if (
    !plan ||
    plan.bookId !== ctx.session.bookId ||
    plan.userId !== ctx.user.id ||
    plan.expiresAt <= Date.now()
  )
    fail('RESET_RESTORE_PLAN', '恢复预览不存在或已过期，请重新预览');
  if (input.confirmText !== '恢复重置前整账')
    fail('RESET_RESTORE_CONFIRM', '请准确输入“恢复重置前整账”');
  if (!ctx.token) fail('RESET_LOGIN', '登录已失效，请重新登录');
  await ctx.app.lifecycle.maintainBook({
    token: ctx.token,
    bookId: plan.bookId,
    permission: 'fixed-assets.reset',
    confirmation: { bookId: plan.bookId, bookName: input.bookName, password: input.password },
    authorize: async () => {
      if (ctx.app.bookStore.revision(plan.bookId) !== plan.revision)
        fail('PREVIEW_CHANGED', '账套数据已改变，恢复未执行', '请重新预览重置前保护备份');
    },
    plan: {
      kind: 'replace',
      replacementId: input.replacementId,
      validate: async (book) => {
        const count = (
          book.raw.prepare('SELECT COUNT(*) AS count FROM fixed_assets_card').get() as {
            count: number;
          }
        ).count;
        if (count !== plan.cardCount)
          fail('RESET_RESTORE_VERIFY', '恢复后的资产数量校验失败，正在回滚');
      },
    },
  });
  plans.get(ctx.app)?.delete(input.replacementId);
  return { message: '已恢复重置前的完整账套，恢复前的当前账套也已自动备份，请重新登录' };
}
