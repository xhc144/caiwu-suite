import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { BusinessError, dimensionsKey, qtyToE6, type ModuleManifest } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { AppRuntime } from '@caiwu/server-kit';
import { digest } from './buckets';
import { allVouchers, fail, tables } from './transfers';

const normalizeOpening = (rows: Awaited<ReturnType<CoreServices['opening']['list']>>) =>
  rows
    .map((r) => [
      `${r.accountId}|${dimensionsKey(r.dimensions)}|${r.currency ?? ''}`,
      r.balance,
      r.fcBalance,
      qtyToE6(r.quantity),
      r.ytdDebit,
      r.ytdCredit,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
/** 只撤销本模块可识别且完全未使用的最近一份派生快照，不推测手工期初。 */
export async function reverseYearPlan(
  svc: CoreServices,
  year: number,
  loadedModules: readonly ModuleManifest[] = [],
) {
  const records = await tables(svc)
    .selectFrom('period_close_year')
    .selectAll()
    .orderBy('source_year')
    .execute();
  const record = records.find((r) => r.source_year === year);
  if (!record)
    fail(
      'NO_YEAR_SNAPSHOT',
      `${year} 年没有本模块可识别的年结快照`,
      '不能删除手工期初；先核对年结记录',
    );
  if (records.at(-1)?.source_year !== year)
    fail('REVERSE_YEAR_ORDER', '只能先撤销最近一次年结', '按年度从后到前撤销派生快照');
  const unknownDependencies = loadedModules.filter(
    (m) => m.id !== 'period-close' && !m.devOnly && (m.sources?.length ?? 0) > 0,
  );
  if (unknownDependencies.length)
    fail(
      'MODULE_DEPENDENCIES_UNKNOWN',
      '存在尚无统一期间依赖查询的其他业务来源模块',
      '先由共享层提供后年度未生成凭证业务的依赖检查；当前仅凭核心凭证不能证明可安全删除派生期初',
      undefined,
      { modules: unknownDependencies.map((m) => ({ id: m.id, name: m.name })) },
    );
  const target = record.target_year;
  const years = await svc.periods.years();
  if (target !== year + 1 || years.some((y) => y.year > target))
    fail(
      'REVERSE_YEAR_ORDER',
      '后面仍有其他会计年度，不能跳年撤销',
      '先处理后续年度，不会猜测删除未识别的年度',
    );
  const sourceYear = years.find((y) => y.year === year);
  const targetYear = years.find((y) => y.year === target);
  if (
    sourceYear?.status !== 'closed' ||
    !targetYear ||
    targetYear.status !== 'open' ||
    targetYear.opening_stored !== 1
  )
    fail('SNAPSHOT_STATE', '年结标记与会计年度状态不一致', '保留数据并核对，不能删除未核实的期初');
  const periods = await svc.periods.list();
  const targetPeriods = periods.filter((p) => p.year === target);
  const book = await svc.book.info();
  const sourcePeriods = periods.filter((p) => p.year === year);
  const sourceFirst = Math.trunc(book.startPeriod / 100) === year ? book.startPeriod % 100 : 1;
  if (
    sourcePeriods.length !== 13 - sourceFirst ||
    sourcePeriods.some((p, i) => p.period !== year * 100 + sourceFirst + i || p.status !== 'closed')
  )
    fail('SNAPSHOT_STATE', '来源年度期间缺失或已撤销结账', '保留数据并核对年结与期间状态');

  if (
    targetPeriods.length !== 12 ||
    targetPeriods.some((p, i) => p.status !== 'open' || p.period !== target * 100 + 1 + i)
  )
    fail(
      'TARGET_PERIOD_CLOSED',
      `${target} 年已有结账期间或期间缺失`,
      '先从最近已结期间逐月反结账，再预览逆年结',
    );
  const business = await allVouchers(svc, target * 100 + 1, target * 100 + 12);
  if (business.length)
    fail(
      'TARGET_HAS_BUSINESS',
      `${target} 年还有 ${business.length} 张凭证（含草稿及作废），不能撤销派生期初`,
      '先按合法状态顺序撤销后年度业务，再删除其凭证；不会直接清除业务',
      target * 100 + 1,
      { vouchers: business.map((v) => ({ id: v.id, displayNo: v.displayNo, status: v.status })) },
    );
  const rows = await svc.opening.list(target);
  const stored = JSON.parse(record.snapshot) as typeof rows;
  if (!rows.length || digest(normalizeOpening(rows)) !== digest(normalizeOpening(stored)))
    fail(
      'SNAPSHOT_CHANGED',
      `${target} 年期初已修改、缺失或不是完整的派生快照`,
      '保留现有期初，不能猜测覆盖或删除',
    );
  const accounts = await svc.accounts.list();
  return {
    sourceYear: year,
    targetYear: target,
    rows: rows.map((r) => ({
      ...r,
      accountCode: accounts.find((a) => a.id === r.accountId)?.code ?? String(r.accountId),
    })),
    periods: targetPeriods.map((p) => p.period),
    confirmationText: `撤销${year}年年结`,
    impact: `仅撤销 ${target} 年本模块生成的 ${rows.length} 行期初和 ${targetPeriods.length} 个月份，保留 ${year} 年全部已结月份、凭证及手工期初；随后才可逐月反结账。`,
  };
}
/** 在事务里同样可调用，所用连接全部来自入参 svc。 */
async function financialFingerprint(svc: CoreServices) {
  const payload: unknown[] = [];
  for (const table of [
    'book_info',
    'fiscal_year',
    'period',
    'voucher',
    'voucher_line',
    'opening_balance',
    'account',
    'account_dimension',
    'currency',
    'exchange_rate',
    'dimension_item',
    'voucher_type',
  ] as const) {
    const rows = await svc.db.selectFrom(table).selectAll().execute();
    payload.push([table, rows.map((r) => JSON.stringify(r)).sort()]);
  }
  for (const table of ['period_close_rule', 'period_close_run', 'period_close_year'] as const) {
    const rows = await tables(svc).selectFrom(table).selectAll().execute();
    payload.push([table, rows.map((r) => JSON.stringify(r)).sort()]);
  }
  return digest(payload);
}
const MetadataSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  bookId: z.uuid(),
  createdBy: z.number().int(),
  sourceYear: z.number().int(),
  targetYear: z.number().int(),
  fingerprint: z.string(),
  sha256: z.string(),
  createdAt: z.string(),
});
const directory = (app: AppRuntime, bookId: string) =>
  path.join(app.dataDir, 'period-close', 'backups', bookId);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export async function backupReverseYear(
  svc: CoreServices,
  app: AppRuntime,
  bookId: string,
  year: number,
) {
  svc.permissions.require('period-close.year-end');
  const plan = await reverseYearPlan(svc, year, app.modules.manifests());
  const fingerprint = await financialFingerprint(svc);
  const id = randomUUID();
  const dir = directory(app, bookId);
  const file = path.join(dir, `${id}.caiwu`);
  const metaFile = path.join(dir, `${id}.json`);
  try {
    await mkdir(dir, { recursive: true });
    // SQLite 在线快照：先完成备份，再允许输入确认文字；此时不写账套任何行。
    await app.bookStore.open(bookId).raw.backup(file);
    const raw = new Database(file, { readonly: true, fileMustExist: true });
    try {
      if (
        raw.pragma('quick_check', { simple: true }) !== 'ok' ||
        (raw.prepare('SELECT book_id FROM book_info WHERE id=1').get() as { book_id: string })
          .book_id !== bookId
      )
        throw new Error('在线备份校验失败');
    } finally {
      raw.close();
    }
    if ((await financialFingerprint(svc)) !== fingerprint)
      fail('BACKUP_STALE', '备份过程中账套数据已变化', '重新预览并备份后再确认');
    const metadata = {
      version: 1 as const,
      id,
      bookId,
      createdBy: svc.user.id,
      sourceYear: year,
      targetYear: plan.targetYear,
      fingerprint,
      sha256: sha(await readFile(file)),
      createdAt: app.now().toISOString(),
    };
    await writeFile(metaFile, JSON.stringify(metadata, null, 2), { flag: 'wx' });
    return {
      backupId: id,
      plan,
      createdAt: metadata.createdAt,
      relativePath: `period-close/backups/${bookId}/${id}.caiwu`,
      message: 'SQLite 在线备份已成功并校验；现在才可输入文字再次确认撤销',
    };
  } catch (error) {
    await rm(file, { force: true });
    await rm(metaFile, { force: true });
    if (error instanceof BusinessError) throw error;
    fail(
      'BACKUP_FAILED',
      '在线备份未成功，账套保持不变',
      '检查运行时数据目录的可写空间后重试；不会通过复制主文件代替在线备份',
    );
  }
}
export async function reverseYear(
  svc: CoreServices,
  app: AppRuntime,
  bookId: string,
  input: { year: number; backupId: string; confirmed: boolean; confirmText: string },
) {
  svc.permissions.require('period-close.year-end');
  if (!input.confirmed || input.confirmText !== `撤销${input.year}年年结`)
    fail('CONFIRM', '请在在线备份成功后输入指定文字并再次确认', '取消不会修改账套');
  if (!z.uuid().safeParse(input.backupId).success)
    fail('BACKUP_REQUIRED', '缺少受管备份标识', '先在本页执行在线备份');
  const dir = directory(app, bookId);
  const file = path.join(dir, `${input.backupId}.caiwu`);
  const metadata = await readFile(path.join(dir, `${input.backupId}.json`), 'utf8')
    .then((s) => MetadataSchema.safeParse(JSON.parse(s) as unknown))
    .catch(() => null);
  if (
    !metadata?.success ||
    metadata.data.bookId !== bookId ||
    metadata.data.sourceYear !== input.year ||
    metadata.data.createdBy !== svc.user.id
  )
    fail('BACKUP_REQUIRED', '未找到当前操作员为本账套创建的有效在线备份', '重新预览并执行在线备份');
  const backupHash = await readFile(file)
    .then(sha)
    .catch(() => null);
  if (backupHash !== metadata.data.sha256)
    fail('BACKUP_INVALID', '在线备份文件缺失或校验不符', '重新备份；当前账套未修改');
  try {
    return await svc.tx(async (t) => {
      const plan = await reverseYearPlan(t, input.year, app.modules.manifests());
      if ((await financialFingerprint(t)) !== metadata.data.fingerprint)
        fail('BACKUP_STALE', '备份后财务数据已变化，不能撤销', '重新预览、备份并确认最新影响');
      await tables(t)
        .deleteFrom('period_close_year')
        .where('source_year', '=', input.year)
        .execute();
      await t.opening.replaceYear(plan.targetYear, []);
      await t.db.deleteFrom('period').where('year', '=', plan.targetYear).execute();
      await t.db.deleteFrom('fiscal_year').where('year', '=', plan.targetYear).execute();
      await t.db
        .updateTable('fiscal_year')
        .set({ status: 'open', closed_at: null, closed_by: null })
        .where('year', '=', input.year)
        .execute();
      await t.log.write({
        action: 'period-close.reverse-year',
        summary: `在线备份后撤销 ${input.year} 年年结；仅删除可识别的 ${plan.targetYear} 年派生期初`,
        detail: {
          backupId: input.backupId,
          targetYear: plan.targetYear,
          rows: plan.rows.length,
          periods: plan.periods,
        },
      });
      return {
        message: `${input.year} 年年结已撤销；已保留在线备份。现在可从 ${input.year}12 开始逐月反结账`,
        sourceYear: input.year,
      };
    });
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    fail(
      'REVERSE_DEPENDENCIES',
      '后年度仍有关联或撤销中途失败，账套已整体回滚',
      '先撤销后年度业务关联，再重新预览；在线备份已保留',
    );
  }
}
