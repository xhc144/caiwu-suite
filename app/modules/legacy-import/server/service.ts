import { randomUUID } from 'node:crypto';
import { levelOfCode, parentCodeOf, periodOfDate, sumCents, type Account } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { sql, type Selectable } from '@caiwu/db';
import type { BatchView, ImportPlan, PrepareInput, Reconciliation } from '../shared';
import type { ImportTables } from './migrations';
import { buildPlan } from './plan';
import { fail, inspection, parseFiles, sha256 } from './parse';

type BatchRow = Selectable<ImportTables['legacy_import_batch']>;
const toView = (r: BatchRow): BatchView => ({
  id: r.id,
  status: r.status,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  files: JSON.parse(r.files_json) as BatchView['files'],
  contentHash: r.content_hash,
  counts: (JSON.parse(r.plan_json) as ImportPlan).counts,
  reconciliation: r.reconciliation_json
    ? (JSON.parse(r.reconciliation_json) as Reconciliation)
    : null,
});
class PreviewRollback extends Error {
  constructor(readonly report: Reconciliation) {
    super('预检事务回滚');
  }
}

const CORE_SETUP_TABLES = new Set([
  '_migration',
  'book_info',
  'book_setting',
  'fiscal_year',
  'period',
  'app_user',
  'user_permission',
  'operation_log',
  'account_category',
  'currency',
  'exchange_rate',
  'dimension_type',
  'dimension_item',
  'account',
  'account_dimension',
  'voucher_type',
  'settlement_method',
  'summary_phrase',
  'voucher',
  'voucher_line',
  'opening_balance',
  'legacy_import_batch',
]);

/** 仅检查其它模块是否有行，绝不写入其它模块。未知表有数据时从严阻止。 */
async function assertOtherModulesEmpty(svc: CoreServices, accounts: Account[]) {
  const tables = await sql<{
    name: string;
  }>`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`.execute(svc.db);
  for (const { name } of tables.rows) {
    if (CORE_SETUP_TABLES.has(name) || name.startsWith('sqlite_')) continue;
    if (name === 'inventory_control') {
      const rows = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(name)}`.execute(
        svc.db,
      );
      const expected = {
        id: 1,
        stock_revision: 0,
        opening_revision: 0,
        cost_cutoff_date: null,
        cost_period: null,
        cost_batch: null,
        opening_locked: 0,
      };
      if (
        rows.rows.length !== 1 ||
        JSON.stringify(Object.entries(rows.rows[0]!).sort()) !==
          JSON.stringify(Object.entries(expected).sort())
      )
        fail('仓库控制状态不是新账默认值，禁止导入');
      continue;
    }
    if (name === 'masterdata_money_root') {
      const rows = await sql<{
        account_id: number;
        kind: string;
      }>`SELECT * FROM ${sql.table(name)} ORDER BY account_id`.execute(svc.db);
      const expected = accounts
        .filter((a) => a.parentId == null && (a.isCash || a.isBank))
        .map((a) => ({ account_id: a.id, kind: a.isCash ? 'cash' : 'bank' }))
        .sort((a, b) => a.account_id - b.account_id);
      // BookStore 在写入模板科目前运行模块迁移，因此刚建好的账套可为空。
      if (rows.rows.length && JSON.stringify(rows.rows) !== JSON.stringify(expected))
        fail('科目资金根配置不是新账默认值，禁止导入');
      continue;
    }
    const row = await sql`SELECT 1 FROM ${sql.table(name)} LIMIT 1`.execute(svc.db);
    if (row.rows.length)
      fail(`目标表 ${name} 已有记录或未支持的默认数据，无法证明是新空账，禁止导入`);
  }
  const settings = await svc.db.selectFrom('book_setting').select(['scope', 'key']).execute();
  if (settings.some((s) => s.scope !== 'core' || s.key !== 'lastOpenedAt'))
    fail('目标已有模块设置，无法证明是新空账，禁止导入');
}

/** 核心数据只读；所有写入经 core 服务，仅本模块批次表直接写入。 */
async function target(svc: CoreServices) {
  const info = await svc.book.info();
  const accounts = await svc.accounts.list();
  await assertOtherModulesEmpty(svc, accounts);
  const types = await svc.reference.voucherTypes();
  const categories = await svc.accounts.categories();
  const periods = await svc.periods.list();
  const years = await svc.periods.years();
  const vouchers = await svc.db.selectFrom('voucher').select('id').limit(1).execute();
  const openings = await svc.db.selectFrom('opening_balance').select('id').limit(1).execute();
  const logs = await svc.db.selectFrom('operation_log').select(['module', 'action']).execute();
  const completed = await svc.db
    .withTables<ImportTables>()
    .selectFrom('legacy_import_batch')
    .select('id')
    .where('status', '=', 'completed')
    .limit(1)
    .execute();
  if (completed.length) fail('此账套已导入过，禁止重复导入');
  if (
    vouchers.length ||
    openings.length ||
    logs.some(
      (l) =>
        l.module !== 'core' || !['book.create', 'auth.login', 'auth.logout'].includes(l.action),
    ) ||
    periods.some((p) => p.status !== 'open') ||
    years.length !== 1 ||
    years.some((y) => y.status !== 'open')
  )
    fail('目标账套已有业务记录、期初或关闭期间；为保护原数据，只能向新空账导入');
  const age = svc.ctx.now().getTime() - Date.parse(info.createdAt);
  if (age < 0 || age > 24 * 60 * 60 * 1000) fail('仅支持 24 小时内新建的空账套，请另建账套后导入');
  return {
    info,
    accounts,
    types,
    categories,
    periods,
    hash: sha256(JSON.stringify({ info, accounts, types, categories, periods, years })),
  };
}

function flagsMatch(a: Account, r: ImportPlan['accounts'][number]) {
  return (
    a.name === r.name &&
    a.categoryId === r.category &&
    a.direction === r.direction &&
    a.isCash === r.cash &&
    a.isBank === r.bank &&
    a.cashflowRequired === r.cashflow &&
    a.isPartner === r.partner &&
    a.disabled === r.disabled
  );
}

async function validateTarget(svc: CoreServices, plan: ImportPlan) {
  const snapshot = await target(svc);
  const planned = new Set(plan.accounts.map((r) => r.code));
  const existing = new Map(snapshot.accounts.map((a) => [a.code, a]));
  for (const r of plan.accounts) {
    if (levelOfCode(r.code, snapshot.info.codeScheme) == null)
      fail(`科目 ${r.code} 长度不符合目标级次`);
    const parent = parentCodeOf(r.code, snapshot.info.codeScheme);
    if (parent && !planned.has(parent)) fail(`来源缺少科目 ${r.code} 的上级 ${parent}`);
    if (!snapshot.categories.some((c) => c.id === r.category))
      fail(`科目 ${r.code} 类别 ${r.category} 不存在`);
    const a = existing.get(r.code);
    if (!a && !parent && (r.cash || r.bank))
      fail(`新资金根科目 ${r.code} 需要基础档案 owner 同步资金根配置，当前禁止不完整迁移`);
    if (a && !flagsMatch(a, r))
      fail(`科目 ${r.code} 与目标模板名称、类别、方向或标志不同，禁止覆盖`);
    if (a && (a.currency || a.quantityUnit || a.dimensions.length || a.mnemonic))
      fail(`科目 ${r.code} 含尚未支持的外币、数量、辅助核算或助记码，须核对后使用完整迁移接口`);
    if (
      a &&
      !a.isLeaf &&
      !plan.accounts.some((b) => b.code !== r.code && b.code.startsWith(r.code))
    )
      fail(`来源末级科目 ${r.code} 在目标有下级，禁止改变汇总口径`);
  }
  for (const v of plan.vouchers) {
    if (!snapshot.types.some((t) => t.code === v.type && !t.disabled))
      fail(`凭证类型 ${v.type} 不存在或已停用`);
    if (!snapshot.periods.some((p) => p.period === periodOfDate(v.date) && p.status === 'open'))
      fail(`凭证 ${v.sourceId} 所在期间未开放`);
  }
  return snapshot;
}

async function applyPlan(svc: CoreServices, plan: ImportPlan, id: string): Promise<Reconciliation> {
  const snapshot = await validateTarget(svc, plan);
  const accounts = new Map(snapshot.accounts.map((a) => [a.code, a]));
  for (const r of plan.accounts)
    if (!accounts.has(r.code)) {
      const a = await svc.accounts.create(
        {
          code: r.code,
          name: r.name,
          categoryId: r.category,
          direction: r.direction,
          isCash: r.cash,
          isBank: r.bank,
          cashflowRequired: r.cashflow,
          isPartner: r.partner,
          disabled: r.disabled,
        },
        snapshot.info.codeScheme,
      );
      accounts.set(r.code, a);
    }
  for (const r of plan.opening)
    await svc.opening.upsert({
      year: Math.trunc(plan.periodFrom / 100),
      accountId: accounts.get(r.code)!.id,
      balance: r.balance,
      ytdDebit: r.ytdDebit,
      ytdCredit: r.ytdCredit,
    });
  const voucherIds: number[] = [];
  for (const v of plan.vouchers) {
    const voucher = await svc.vouchers.create({
      date: v.date,
      voucherTypeId: snapshot.types.find((t) => t.code === v.type)!.id,
      number: v.number,
      attachments: v.attachments,
      source: { type: 'batch', id },
      lines: v.lines.map((l) => ({
        accountId: accounts.get(l.code)!.id,
        summary: l.summary,
        debit: l.debit,
        credit: l.credit,
      })),
    });
    voucherIds.push(voucher.id);
    // 回读凭证全部已支持字段，任何核心规范化差异都阻止整批提交。
    const actual = await svc.vouchers.get(voucher.id);
    if (
      !actual ||
      actual.date !== v.date ||
      actual.number !== v.number ||
      actual.attachments !== v.attachments ||
      actual.voucherTypeCode !== v.type ||
      actual.status !== 'pending' ||
      actual.voided ||
      actual.source?.module !== 'legacy-import' ||
      actual.source.type !== 'batch' ||
      actual.source.id !== id ||
      actual.lines.length !== v.lines.length ||
      actual.lines.some((l, i) => {
        const expected = v.lines[i]!;
        return (
          l.lineNo !== expected.line ||
          l.accountCode !== expected.code ||
          l.summary !== expected.summary ||
          l.debit !== expected.debit ||
          l.credit !== expected.credit
        );
      })
    )
      fail(`凭证 ${v.sourceId} 写入回读不一致，整批回滚`);
  }
  const actualAccounts = await svc.accounts.list();
  for (const r of plan.accounts) {
    const a = actualAccounts.find((v) => v.code === r.code);
    const expectedLeaf = !plan.accounts.some((b) => b.code !== r.code && b.code.startsWith(r.code));
    if (!a || !flagsMatch(a, r) || a.isLeaf !== expectedLeaf)
      fail(`科目 ${r.code} 写入回读不一致，整批回滚`);
  }
  const actualOpening = await svc.opening.list(Math.trunc(plan.periodFrom / 100));
  if (
    actualOpening.length !== plan.counts.opening ||
    plan.opening.some((r) => {
      const a = actualOpening.find((o) => o.accountId === accounts.get(r.code)!.id);
      return (
        !a ||
        a.balance !== r.balance ||
        a.ytdDebit !== r.ytdDebit ||
        a.ytdCredit !== r.ytdCredit ||
        a.currency != null ||
        a.fcBalance !== 0 ||
        a.quantity !== '0' ||
        Object.values(a.dimensions).some((v) => v != null)
      );
    })
  )
    fail('期初写入回读不一致，整批回滚');

  const balances = await svc.ledger.balances({
    periodFrom: plan.periodFrom,
    periodTo: plan.periodTo,
    accountCodes: plan.balances.map((r) => r.code),
    includeUnposted: true,
    rollup: false,
    includeZero: true,
  });
  const actualBalances = plan.balances.map((r) => {
    const b = balances.find((v) => v.accountCode === r.code);
    if (!b) fail(`科目 ${r.code} 在目标余额中缺失，整批回滚`);
    const actual = {
      code: b.accountCode,
      opening: b.opening,
      debit: b.debit,
      credit: b.credit,
      closing: b.closing,
      ytdDebit: b.ytdDebit,
      ytdCredit: b.ytdCredit,
    };
    if (
      Object.keys(actual).some((k) => actual[k as keyof typeof actual] !== r[k as keyof typeof r])
    )
      fail(`科目 ${r.code} 目标余额与来源对照不一致，整批回滚`);
    return actual;
  });
  const countRows = await svc.db.selectFrom('voucher').select('id').execute();
  const lineRows = await svc.db.selectFrom('voucher_line').select('id').execute();
  if (
    countRows.length !== plan.counts.vouchers ||
    lineRows.length !== plan.counts.lines ||
    actualBalances.length !== plan.counts.balances ||
    balances.length !== actualBalances.length ||
    actualAccounts.filter((a) => plan.accounts.some((r) => r.code === a.code)).length !==
      plan.counts.accounts
  )
    fail('目标科目、期初、凭证、分录或余额计数与来源不一致，整批回滚');
  return {
    counts: plan.counts,
    templateAccounts: actualAccounts.length - plan.counts.accounts,
    balances: actualBalances,
    voucherIds,
    openingTotal: sumCents(actualOpening.map((r) => r.balance)),
    debitTotal: sumCents(actualBalances.map((r) => r.debit)),
    creditTotal: sumCents(actualBalances.map((r) => r.credit)),
  };
}

export function importService(svc: CoreServices) {
  const db = svc.db.withTables<ImportTables>();
  return {
    async list() {
      svc.permissions.require('legacy-import.view');
      return (
        await db
          .selectFrom('legacy_import_batch')
          .selectAll()
          .orderBy('created_at', 'desc')
          .limit(20)
          .execute()
      ).map(toView);
    },
    async get(id: string) {
      svc.permissions.require('legacy-import.view');
      const row = await db
        .selectFrom('legacy_import_batch')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) fail('导入批次不存在');
      return { ...toView(row), plan: JSON.parse(row.plan_json) as ImportPlan };
    },
    async inspect(files: PrepareInput['files']) {
      svc.permissions.require('legacy-import.prepare');
      return inspection(await parseFiles(files));
    },
    async prepare(input: PrepareInput) {
      svc.permissions.require('legacy-import.prepare');
      svc.permissions.require('legacy-import.view');
      const parsed = await parseFiles(input.files);
      const info = await svc.book.info();
      const plan = buildPlan(parsed, input, info.startPeriod);
      const snapshot = await validateTarget(svc, plan);
      const id = randomUUID();
      let preview: Reconciliation | undefined;
      // 使用相同 core 写入与回读路径做真实事务演练，成功也必须回滚。
      try {
        await svc.tx(async (tx) => {
          throw new PreviewRollback(await applyPlan(tx, plan, id));
        });
      } catch (error) {
        if (!(error instanceof PreviewRollback)) throw error;
        preview = error.report;
      }
      const now = svc.ctx.now();
      await svc.tx(async (tx) => {
        if ((await target(tx)).hash !== snapshot.hash) fail('预检过程中目标已变化，请重新预检');
        await tx.db
          .withTables<ImportTables>()
          .insertInto('legacy_import_batch')
          .values({
            id,
            owner_id: svc.user.id,
            status: 'prepared',
            created_at: now.toISOString(),
            expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            files_json: JSON.stringify(parsed.files),
            content_hash: sha256(JSON.stringify(plan)),
            plan_json: JSON.stringify(plan),
            target_hash: snapshot.hash,
            reconciliation_json: null,
          })
          .execute();
      });
      return { ...(await this.get(id)), preview };
    },
    async execute(input: { id: string; confirmation: string }) {
      svc.permissions.require('legacy-import.execute');
      svc.permissions.require('legacy-import.view');
      return svc.tx(async (tx) => {
        const tdb = tx.db.withTables<ImportTables>();
        const row = await tdb
          .selectFrom('legacy_import_batch')
          .selectAll()
          .where('id', '=', input.id)
          .executeTakeFirst();
        if (!row) fail('导入批次不存在');
        if (row.status === 'completed') fail('此批次已完成，禁止重复执行');
        if (row.owner_id !== tx.user.id) fail('只能由执行预检的操作员提交本批次');
        if (tx.ctx.now().getTime() >= Date.parse(row.expires_at))
          fail('预检已过期，请重新核对来源并预检');
        const snapshot = await target(tx);
        if (input.confirmation !== `导入 ${snapshot.info.name}`)
          fail('确认文字不匹配，请输入「导入 空账套名称」');
        if (snapshot.hash !== row.target_hash) fail('目标账套或基础资料已变化，请重新预检');
        const plan = JSON.parse(row.plan_json) as ImportPlan;
        if (sha256(JSON.stringify(plan)) !== row.content_hash)
          fail('预检内容校验失败，请重新上传来源');
        const report = await applyPlan(tx, plan, row.id);
        await tdb
          .updateTable('legacy_import_batch')
          .set({
            status: 'completed',
            reconciliation_json: JSON.stringify(report),
          })
          .where('id', '=', row.id)
          .execute();
        await tx.log.write({
          action: 'legacy-import.execute',
          summary: `标准化导入 ${plan.counts.vouchers} 张待审核凭证，来源与余额核对一致`,
          targetType: 'legacy_import_batch',
          targetId: row.id,
          detail: {
            files: JSON.parse(row.files_json) as unknown,
            contentHash: row.content_hash,
            counts: report.counts,
          },
        });
        return report;
      });
    },
  };
}
