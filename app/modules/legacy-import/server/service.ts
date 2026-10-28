import { createHash, randomUUID } from 'node:crypto';
import {
  BusinessError,
  Decimal,
  DIMENSION_TYPES,
  OPENING_DIMENSION_TYPES,
  dimensionsKey,
  dimensionName,
  formatMoney,
  levelOfCode,
  parentCodeOf,
  periodOfDate,
  qtyToE6,
  VoucherInputSchema,
  type Account,
  type DimensionItem,
  type DimensionTypeId,
  type DimensionValues,
  type VoucherInput,
  type VoucherLineInput,
} from '@caiwu/core';
import type { CoreServices, CreateAccountInput } from '@caiwu/core/server';
import {
  PrepareSchema,
  type PrepareInput,
  type ImportBatch,
  type ImportIssue,
  type ImportOptions,
  type ImportReceipt,
  type ImportSummary,
} from '../shared';
import { parseImportFile, buildImportTemplate, buildSourceExport } from './files';
import {
  CellError,
  date,
  decimal,
  dimensionType,
  fieldLabel,
  flag,
  integer,
  issueFor,
  money,
  normalizeFile,
  requiredText,
  side,
  type ImportPayload,
  type SourceRow,
} from './normalize';
import type { ImportTables } from './migrations';

const emptySummary = (): ImportSummary => ({
  accounts: 0,
  dimensions: 0,
  opening: 0,
  vouchers: 0,
  lines: 0,
  reusedAccounts: 0,
  reusedDimensions: 0,
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)) ?? 'undefined')
    .digest('hex');
type RunResult = {
  issues: ImportIssue[];
  summary: ImportSummary;
  vouchers: ImportReceipt['vouchers'];
};
class RolledBack extends Error {
  constructor(readonly result: RunResult) {
    super('预检回滚');
  }
}
class InvalidImport extends Error {
  constructor(readonly result: RunResult) {
    super('迁移校验未通过');
  }
}
type BatchRow = ImportTables['legacy_import_batch'];
type VoucherGroup = {
  row: SourceRow;
  date: string;
  typeId: number;
  number: number;
  original: string;
  attachments: number;
  note: string | null;
  rows: SourceRow[];
  lines: VoucherLineInput[];
  bad: boolean;
};

function toBatch(row: BatchRow): ImportBatch {
  const payload = JSON.parse(row.payload) as ImportPayload;
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    issues: JSON.parse(row.issues) as ImportIssue[],
    summary: JSON.parse(row.summary) as ImportSummary,
    options: JSON.parse(row.options) as ImportOptions,
    files: payload.files,
    receipt: row.receipt ? (JSON.parse(row.receipt) as ImportReceipt) : null,
  };
}

/** 只包含会影响迁移的账务状态；日志、其他批次预检不使当前预检失效。 */
async function fingerprint(svc: CoreServices): Promise<string> {
  const db = svc.db;
  const states = await Promise.all([
    svc.book.info(),
    svc.accounts.list(),
    svc.dimensions.items(),
    svc.accounts.categories(),
    svc.reference.voucherTypes(),
    svc.reference.currencies(),
    svc.reference.settlementMethods(),
    svc.voucherPolicy.get(),
    db.selectFrom('fiscal_year').selectAll().orderBy('year').execute(),
    db.selectFrom('period').selectAll().orderBy('period').execute(),
    db.selectFrom('opening_balance').selectAll().orderBy('id').execute(),
    db
      .selectFrom('book_setting')
      .selectAll()
      .where('scope', '=', 'opening')
      .orderBy('key')
      .execute(),
    db
      .selectFrom('voucher')
      .select(['id', 'period', 'voucher_type_id', 'number', 'revision', 'status', 'voided'])
      .orderBy('id')
      .execute(),
    db
      .withTables<ImportTables>()
      .selectFrom('legacy_import_voucher')
      .selectAll()
      .orderBy('fingerprint')
      .execute(),
  ]);
  return hash(states);
}

function assertAllowed(svc: CoreServices, permission: string) {
  svc.permissions.require(permission);
}

async function perform(
  svc: CoreServices,
  payload: ImportPayload,
  options: ImportOptions,
  batchId: string,
): Promise<RunResult> {
  const result: RunResult = { issues: [...payload.issues], summary: emptySummary(), vouchers: [] };
  const add = (row: SourceRow, error: unknown) => result.issues.push(...issueFor(row, error));
  const fail = (column: string, message: string): never => {
    throw new CellError(fieldLabel(column), message);
  };
  const validRows = payload.rows.filter(
    (r) =>
      !payload.issues.some(
        (i) =>
          i.severity === 'error' &&
          i.file === r.location.file &&
          i.sheet === r.location.sheet &&
          (i.row === r.location.row || (i.row < r.location.row && i.column === '')),
      ),
  );
  const book = await svc.book.info();
  const masterPeriod = (await svc.periods.current())?.period ?? book.startPeriod;
  const [accountList, dimList, categories, currencies, types, methods] = await Promise.all([
    svc.accounts.list(),
    svc.dimensions.items(),
    svc.accounts.categories(),
    svc.reference.currencies(),
    svc.reference.voucherTypes(),
    svc.reference.settlementMethods(),
  ]);
  const accounts = new Map(accountList.map((a) => [a.code, a]));
  const dims = new Map(dimList.map((d) => [`${d.typeId}:${d.code}`, d]));
  const currency = (row: SourceRow): string | null => {
    const code = row.values.currency;
    if (!code || code === book.baseCurrency) return null;
    if (!currencies.some((c) => c.code === code && !c.disabled))
      fail('currency', `币种 ${code} 不存在或已停用，请先在基础档案维护`);
    return code;
  };
  // 科目新增也受服务端期间与年度锁保护。
  const seenAccounts = new Set<string>();
  for (const row of validRows
    .filter((r) => r.kind === 'accounts')
    .sort((a, b) => (a.values.code?.length ?? 0) - (b.values.code?.length ?? 0))) {
    try {
      const code = requiredText(row, 'code', 40),
        name = requiredText(row, 'name');
      if (seenAccounts.has(code)) fail('code', `本批科目编码 ${code} 重复，请保留一行`);
      seenAccounts.add(code);
      if (levelOfCode(code, book.codeScheme) == null)
        fail('code', `科目编码不符合账套的 ${book.codeScheme.join('-')} 级次，请核对编码`);
      const parentCode = parentCodeOf(code, book.codeScheme),
        parent = parentCode ? accounts.get(parentCode) : undefined;
      if (parentCode && !parent) fail('code', `上级科目 ${parentCode} 不存在，请一并导入上级科目`);
      const categoryValue = row.values.category;
      const category = categoryValue
        ? categories.find((c) => c.id === categoryValue || c.name === categoryValue)
        : undefined;
      if (categoryValue && !category)
        fail('category', `科目类别 ${categoryValue} 不存在，请使用当前账套类别名称`);
      if (parent && category && parent.categoryId !== category.id)
        fail('category', '下级科目类别必须与上级一致，请核对原账编码或类别对应');
      if (parent?.disabled) fail('code', '上级科目已停用，请先核对并启用上级科目');
      if (!parent && !category && !accounts.has(code))
        fail('category', '新增一级科目必须填写科目类别');
      const data: CreateAccountInput = { code, name };
      if (category) data.categoryId = category.id;
      const direction = side(row, 'direction');
      if (direction) data.direction = direction;
      for (const key of ['isCash', 'isBank', 'isPartner', 'disabled', 'isContra'] as const) {
        const v = flag(row, key);
        if (v != null) data[key] = v;
      }
      if (data.isCash && data.isBank) fail('isCash', '同一科目不能同时标为现金和银行科目');
      const flow = flag(row, 'cashflowEnabled');
      if (flow != null) data.cashflowRequired = flow;
      if (row.values.currency != null) data.currency = currency(row);
      if (row.values.quantityUnit != null) data.quantityUnit = row.values.quantityUnit || null;
      if (row.values.mnemonic != null) data.mnemonic = row.values.mnemonic || null;
      if ((data.quantityUnit?.length ?? 0) > 20) fail('quantityUnit', '数量单位不能超过20个字符');
      if ((data.mnemonic?.length ?? 0) > 40) fail('mnemonic', '助记码不能超过40个字符');
      const dimensionFlags: [DimensionTypeId, string][] = [
        ['project', 'projectEnabled'],
        ['partner', 'partnerEnabled'],
        ['department', 'departmentEnabled'],
        ['person', 'personEnabled'],
      ];
      const specified = dimensionFlags.filter(
        ([, key]) => row.values[key] != null && row.values[key] !== '',
      );
      if (specified.length)
        data.dimensions = specified
          .filter(([, key]) => flag(row, key))
          .map(([type]) => ({ type, required: true }));
      if (row.values.balanceNature) {
        const value =
          (
            { 借: 'debit', 贷: 'credit', 双向: 'both', 无余额: 'no-closing-balance' } as Record<
              string,
              string
            >
          )[row.values.balanceNature] ?? row.values.balanceNature;
        if (!['debit', 'credit', 'both', 'no-closing-balance'].includes(value))
          fail('balanceNature', '余额性质应为借、贷、双向或无余额');
        data.balanceNature = value as NonNullable<CreateAccountInput['balanceNature']>;
      }
      if (row.values.closingRule) {
        if (
          ![
            'none',
            'profit',
            'retained-earnings',
            'year-retained-earnings',
            'clearing',
            'seasonal-allocation',
          ].includes(row.values.closingRule)
        )
          fail('closingRule', '结转用途无效，请使用模板约定值');
        data.closingRule = row.values.closingRule as NonNullable<CreateAccountInput['closingRule']>;
      }
      const old = accounts.get(code);
      if (old) {
        if (old.name !== name)
          fail('name', `科目 ${code} 已存在且名称为「${old.name}」，请核对映射；迁移不会覆盖科目`);
        const compare: Record<string, unknown> = {
          categoryId: old.categoryId,
          direction: old.direction,
          isCash: old.isCash,
          isBank: old.isBank,
          isPartner: old.isPartner,
          disabled: old.disabled,
          isContra: old.isContra,
          cashflowRequired: old.cashflowRequired,
          currency: old.currency,
          quantityUnit: old.quantityUnit,
          mnemonic: old.mnemonic,
          balanceNature: old.balanceNature,
          closingRule: old.closingRule,
        };
        for (const [key, value] of Object.entries(data))
          if (key in compare && compare[key] !== value)
            fail(key, `科目 ${code} 已有设置与导入不一致，请在科目维护核对后重试`);
        for (const [type, key] of specified)
          if (old.dimensions.some((d) => d.type === type) !== flag(row, key))
            fail(key, `科目 ${code} 的辅助核算设置与原账不同，请核对后重试`);
        result.summary.reusedAccounts++;
      } else {
        await svc.periods.assertWritable({
          period: masterPeriod,
          mode: 'business',
          action: '导入科目',
        });
        const created = await svc.accounts.create({ ...data, source: '原账迁移' }, book.codeScheme);
        accounts.set(code, created);
        if (parent) accounts.set(parent.code, { ...parent, isLeaf: false });
        result.summary.accounts++;
      }
    } catch (error) {
      add(row, error);
    }
  }
  const seenDims = new Set<string>();
  let remaining = validRows.filter((r) => r.kind === 'dimensions');
  while (remaining.length) {
    const next: SourceRow[] = [];
    let progressed = false;
    for (const row of remaining) {
      try {
        const type = dimensionType(row),
          code = requiredText(row, 'dimCode', 40),
          name = requiredText(row, 'dimName');
        const parentCode = row.values.parentCode,
          parent = parentCode ? dims.get(`${type}:${parentCode}`) : undefined;
        if (parentCode && !parent) {
          next.push(row);
          continue;
        }
        if (code === parentCode) fail('parentCode', '上级编码不能是档案自身');
        const key = `${type}:${code}`;
        if (seenDims.has(key))
          fail('dimCode', `本批${dimensionName(type)}档案编码 ${code} 重复，请保留一行`);
        seenDims.add(key);
        let attrs: Record<string, unknown> | undefined;
        if (row.values.attrs) {
          try {
            const v: unknown = JSON.parse(row.values.attrs);
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
            attrs = v as Record<string, unknown>;
          } catch {
            fail('attrs', '扩展资料必须是有效的资料对象；也可改用联系人等独立资料列');
          }
        }
        const knownAttrs: Record<string, unknown> = { ...attrs };
        for (const key of [
          'contact',
          'phone',
          'address',
          'postalCode',
          'bank',
          'bankAccount',
          'taxNumber',
          'shortName',
        ] as const) {
          const limit =
            key === 'address' ? 300 : key === 'phone' ? 80 : key === 'postalCode' ? 20 : 100;
          if (row.values[key]) {
            const value = requiredText(row, key, limit);
            if (key in knownAttrs && knownAttrs[key] !== value)
              fail(key, '扩展资料与独立资料列不一致，请核对后重试');
            knownAttrs[key] = value;
          }
          const value = knownAttrs[key];
          if (value != null && (typeof value !== 'string' || value.length > limit))
            fail(key, `资料应为不超过${limit}个字符的文本`);
        }
        if (row.values.dimCategory) {
          const value = requiredText(row, 'dimCategory');
          if (knownAttrs.category != null && knownAttrs.category !== value)
            fail('dimCategory', '分类名称与扩展资料不一致');
          knownAttrs.category = value;
        }
        if (
          knownAttrs.category != null &&
          (typeof knownAttrs.category !== 'string' || knownAttrs.category.length > 100)
        )
          fail('dimCategory', '分类名称应为不超过100个字符的文本');
        if (row.values.role) {
          const role =
            (
              { 客户: 'customer', 供应商: 'supplier', 双向: 'both', 客供: 'both' } as Record<
                string,
                string
              >
            )[row.values.role] ?? row.values.role;
          if (knownAttrs.role != null && knownAttrs.role !== role)
            fail('role', '客供角色与扩展资料不一致');
          knownAttrs.role = role;
        }
        if (
          knownAttrs.role != null &&
          !['customer', 'supplier', 'both'].includes(String(knownAttrs.role))
        )
          fail('role', '客供角色须为客户、供应商或双向');
        if (row.values.cashflowDirection) {
          const flow =
            (
              { 流入: 'inflow', 流出: 'outflow', 内部转移: 'internal', 内部: 'internal' } as Record<
                string,
                string
              >
            )[row.values.cashflowDirection] ?? row.values.cashflowDirection;
          if (knownAttrs.cashflowDirection != null && knownAttrs.cashflowDirection !== flow)
            fail('cashflowDirection', '现金流量方向与扩展资料不一致');
          knownAttrs.cashflowDirection = flow;
        }
        if (
          knownAttrs.cashflowDirection != null &&
          !['inflow', 'outflow', 'internal'].includes(String(knownAttrs.cashflowDirection))
        )
          fail('cashflowDirection', '现金流量方向须为流入、流出或内部转移');
        if (Object.keys(knownAttrs).length) attrs = knownAttrs;
        const disabled = flag(row, 'disabled'),
          old = dims.get(key);
        if (old) {
          if (
            old.name !== name ||
            (parentCode != null && (old.parentId ?? null) !== (parent?.id ?? null)) ||
            (disabled != null && old.disabled !== disabled) ||
            (attrs &&
              Object.entries(attrs).some(([key, value]) => hash(value) !== hash(old.attrs[key])))
          )
            fail('dimCode', `档案 ${code} 已存在且资料不同，请先核对基础档案；迁移不会覆盖档案`);
          result.summary.reusedDimensions++;
        } else {
          if (type === 'cashflow' && !attrs?.cashflowDirection)
            fail('cashflowDirection', '新增现金流量项目必须填写流入、流出或内部转移方向');
          if (type === 'partner' && !attrs?.role) {
            attrs = { ...attrs, role: 'both' };
            result.issues.push({
              ...row.location,
              column: '客供角色',
              severity: 'warning',
              message: '未指定客供角色，按客户/供应商双向档案导入，请核对',
            });
          }
          await svc.periods.assertWritable({
            period: masterPeriod,
            mode: 'business',
            action: '导入辅助档案',
          });
          if (
            parent?.isLeaf &&
            (await svc.dimensions.references(parent.id)).some((b) => b.count > 0)
          )
            fail('parentCode', `上级 ${parent.code} 已有引用，不能导入下级；请先调整原档案`);
          const created = await svc.dimensions.create({
            type,
            code,
            name,
            parentId: parent?.id,
            disabled,
            attrs,
          });
          dims.set(key, created);
          if (parent) dims.set(`${type}:${parent.code}`, { ...parent, isLeaf: false });
          result.summary.dimensions++;
        }
        progressed = true;
      } catch (error) {
        add(row, error);
        progressed = true;
      }
    }
    if (!next.length) break;
    if (!progressed) {
      for (const row of next)
        add(row, new CellError('上级编码', '上级档案不存在或层级形成循环，请一并导入正确上级'));
      break;
    }
    remaining = next;
  }

  const accountFor = (row: SourceRow): Account => {
    const code = requiredText(row, 'code', 40),
      account = accounts.get(code);
    if (!account) return fail('code', `科目 ${code} 不存在，请先导入科目`);
    if (!account.isLeaf || account.disabled)
      fail('code', `科目 ${code} 为非末级或已停用，请选择可用末级科目`);
    return account;
  };
  const dimensionsFor = (row: SourceRow, account: Account, opening = false): DimensionValues => {
    const values: DimensionValues = {};
    for (const dt of opening ? OPENING_DIMENSION_TYPES : DIMENSION_TYPES) {
      const code = row.values[dt.id];
      const config = account.dimensions.find((d) => d.type === dt.id);
      if (opening && code && !config)
        fail(dt.id, `科目 ${account.code} 未启用${dt.name}核算，请核对科目设置`);
      let item: DimensionItem | undefined = code ? dims.get(`${dt.id}:${code}`) : undefined;
      if (!code && config?.defaultItemId != null)
        item = [...dims.values()].find((d) => d.id === config.defaultItemId);
      if (code && !item) fail(dt.id, `${dt.name}编码 ${code} 不存在，请一并导入辅助档案`);
      if (item && (!item.isLeaf || item.disabled))
        fail(dt.id, `${dt.name} ${item.code} 已停用或非末级，请核对档案`);
      if (config?.required && !item) fail(dt.id, `科目 ${account.code} 必须填写${dt.name}`);
      if (item) values[dt.id] = item.id;
    }
    return values;
  };
  const openingKeys = new Set<string>(),
    affectedYears = new Map<number, SourceRow>();
  for (const row of validRows.filter((r) => r.kind === 'opening')) {
    try {
      const year = integer(row, 'year', Math.trunc(book.startPeriod / 100), 9999);
      const fiscal = await svc.db
        .selectFrom('fiscal_year')
        .selectAll()
        .where('year', '=', year)
        .executeTakeFirst();
      if (!fiscal) fail('year', `${year}年度未建立，请核对目标账套`);
      await svc.periods.assertWritable({
        period: fiscal!.opening_period,
        mode: 'opening',
        action: '导入期初余额',
      });
      if ((await svc.periods.list()).some((p) => p.year === year && p.status === 'closed'))
        fail('year', `${year}年度已有结账期间，不能修改期初，请先反结账`);
      const account = accountFor(row),
        dimensions = dimensionsFor(row, account, true),
        cur = currency(row);
      if (cur !== (account.currency ?? null))
        fail('currency', `币种与科目 ${account.code} 的外币核算设置不一致`);
      const key = `${year}:${account.id}:${dimensionsKey(dimensions)}:${cur ?? ''}`;
      if (openingKeys.has(key))
        fail('code', '本批存在年度、科目、辅助组合和币种相同的期初，请合并后重试');
      openingKeys.add(key);
      const existing = (await svc.opening.list(year)).find(
        (r) =>
          r.accountId === account.id &&
          dimensionsKey(r.dimensions) === dimensionsKey(dimensions) &&
          r.currency === cur,
      );
      if (existing && options.openingMode === 'reject-existing')
        fail('balance', '该期初组合已有余额；核对后选择“替换相同期初”并重新预检');
      let balance = money(row, 'balance'),
        fcBalance = money(row, 'fcBalance'),
        quantity = decimal(row, 'quantity', true);
      const direction = side(row, 'direction');
      if (direction) {
        if (balance < 0 || fcBalance < 0 || (quantity && new Decimal(quantity).isNegative()))
          fail('direction', '填写期初方向时余额、外币余额和数量请填非负数');
        if (direction === 'credit') {
          balance = -balance;
          fcBalance = -fcBalance;
          if (quantity) quantity = new Decimal(quantity).negated().toFixed();
        }
      }
      const ytdDebit = money(row, 'ytdDebit'),
        ytdCredit = money(row, 'ytdCredit');
      if (ytdDebit < 0 || ytdCredit < 0) fail('ytdDebit', '累计借方和累计贷方应填写非负金额');
      if (fiscal!.opening_period % 100 === 1 && (ytdDebit !== 0 || ytdCredit !== 0))
        fail('ytdDebit', '1月启用不允许填写启用前累计发生额，请置零并通过凭证导入本年发生额');
      if (!Number.isSafeInteger(Number(BigInt(balance) - BigInt(ytdDebit) + BigInt(ytdCredit))))
        fail('balance', '年初余额超出可精确处理范围，请核对期初及累计金额');
      if (!cur && fcBalance !== 0) fail('fcBalance', '本位币科目不能填写外币余额');
      if (!account.quantityUnit && quantity && quantity !== '0')
        fail('quantity', '该科目未启用数量核算，不能填写数量');
      await svc.opening.upsert({
        year,
        accountId: account.id,
        dimensions,
        currency: cur,
        balance,
        fcBalance,
        quantity,
        ytdDebit,
        ytdCredit,
      });
      if (existing)
        result.issues.push({
          ...row.location,
          column: '期初余额',
          severity: 'warning',
          message: `将替换原期初 ${formatMoney(existing.balance)} 元为 ${formatMoney(balance)} 元`,
        });
      affectedYears.set(year, row);
      result.summary.opening++;
    } catch (error) {
      add(row, error);
    }
  }
  for (const [year, row] of affectedYears) {
    const rows = await svc.opening.list(year);
    const grouped = new Map<string, boolean[]>();
    for (const r of rows) {
      const key = `${r.accountId}:${r.currency ?? ''}`;
      const values = grouped.get(key) ?? [];
      values.push(Object.values(r.dimensions).some((id) => id != null));
      grouped.set(key, values);
    }
    if ([...grouped.values()].some((values) => values.includes(true) && values.includes(false)))
      add(
        row,
        new CellError(
          '期初余额',
          '同一科目、币种的无辅助汇总行不能与辅助明细同时存储，请删除汇总行，避免重复计入',
        ),
      );
    const absolute = (v: bigint) => (v < 0n ? -v : v);
    const limit = BigInt(Number.MAX_SAFE_INTEGER);
    const totals = ['balance', 'ytdDebit', 'ytdCredit', 'fcBalance'] as const;
    if (
      totals.some((key) => rows.reduce((sum, r) => sum + absolute(BigInt(r[key])), 0n) > limit) ||
      rows.reduce((sum, r) => sum + absolute(BigInt(qtyToE6(r.quantity))), 0n) > limit ||
      rows.reduce(
        (sum, r) => sum + absolute(BigInt(r.balance) - BigInt(r.ytdDebit) + BigInt(r.ytdCredit)),
        0n,
      ) > limit
    )
      add(
        row,
        new CellError('期初余额', '本年度期初金额、累计或数量合计超出可精确处理范围，请核对后重试'),
      );
    const balance = rows.reduce((sum, r) => sum + BigInt(r.balance), 0n),
      debit = rows.reduce((sum, r) => sum + BigInt(r.ytdDebit), 0n),
      credit = rows.reduce((sum, r) => sum + BigInt(r.ytdCredit), 0n);
    if (balance !== 0n || debit !== credit)
      add(
        row,
        new CellError(
          '期初试算',
          `${year}年导入后的期初借贷不平衡，请补齐全部末级余额；余额差额 ${new Decimal(balance.toString()).div(100).toFixed(2)} 元，累计借贷差额 ${new Decimal((debit - credit).toString()).div(100).toFixed(2)} 元`,
        ),
      );
  }

  const groups = new Map<string, VoucherGroup>();
  for (const row of validRows.filter((r) => r.kind === 'vouchers')) {
    let group: VoucherGroup | undefined;
    try {
      const day = date(row, 'date'),
        typeCode = requiredText(row, 'voucherType', 40),
        number = integer(row, 'number');
      if (row.values.year && integer(row, 'year') !== Number(day.slice(0, 4)))
        fail('year', '来源年度与凭证日期不一致，请核对原表');
      if (row.values.month && integer(row, 'month') !== Number(day.slice(5, 7)))
        fail('month', '来源月份与凭证日期不一致，请核对原表');
      if (number <= 0) fail('number', '原凭证号必须是正整数');
      const type = types.find((t) => (t.code === typeCode || t.name === typeCode) && !t.disabled);
      if (!type) fail('voucherType', `凭证字 ${typeCode} 不存在或已停用，请先在基础档案维护`);
      const key = `${periodOfDate(day)}:${type!.id}:${number}`,
        attachments = integer(row, 'attachments', 0, 9999),
        note = row.values.note || null;
      group = groups.get(key);
      if (!group) {
        group = {
          row,
          date: day,
          typeId: type!.id,
          number,
          original: `${periodOfDate(day)} ${type!.code}-${number}`,
          attachments,
          note,
          rows: [],
          lines: [],
          bad: false,
        };
        groups.set(key, group);
      }
      if (
        group.row.location.file !== row.location.file ||
        group.row.location.sheet !== row.location.sheet
      )
        fail(
          'number',
          '同一原凭证出现在多份来源表中，请核对是否重复导出，并把整张凭证放在同一张表',
        );
      if (group.date !== day || group.attachments !== attachments || group.note !== note)
        fail('date', '同一期间、凭证字和原凭证号的日期、附件数、备注不一致，请核对凭证表头');
      const account = accountFor(row),
        dimensions = dimensionsFor(row, account),
        cur = currency(row);
      const flowValue = row.values.cashflowDirection;
      const flow = flowValue
        ? ((
            { 流入: 'inflow', 流出: 'outflow', 内部转移: 'internal', 内部: 'internal' } as Record<
              string,
              string
            >
          )[flowValue] ?? flowValue)
        : undefined;
      if (flow && !['inflow', 'outflow', 'internal'].includes(flow))
        fail('cashflowDirection', '现金流量方向应为流入、流出或内部转移');
      const settlement = row.values.settlement
        ? methods.find((m) => m.code === row.values.settlement && !m.disabled)
        : undefined;
      if (row.values.settlement && !settlement)
        fail('settlement', '结算方式不存在或已停用，请先维护基础档案');
      const line: VoucherLineInput = {
        accountId: account.id,
        summary: requiredText(row, 'summary', 200),
        debit: money(row, 'debit'),
        credit: money(row, 'credit'),
        dimensions,
        currency: cur,
        quantity: decimal(row, 'quantity', true),
        unitPrice: decimal(row, 'unitPrice'),
        exchangeRate: decimal(row, 'exchangeRate'),
        fcAmount: row.values.fcAmount ? money(row, 'fcAmount') : undefined,
        entrySide: side(row, 'entrySide'),
        cashflowDirection: flow as VoucherLineInput['cashflowDirection'],
        settlementMethodId: settlement?.id,
        refNo: row.values.refNo || null,
        bizDate: row.values.bizDate ? date(row, 'bizDate') : null,
      };
      group.rows.push(row);
      group.lines.push(line);
    } catch (error) {
      if (group) group.bad = true;
      add(row, error);
    }
  }
  for (const group of [...groups.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.typeId - b.typeId || a.number - b.number,
  )) {
    if (group.bad) continue;
    try {
      if (group.rows.length > 999) fail('number', '单张凭证超过999行，请核对原凭证分组');
      const lineNos = new Set<number>();
      for (const row of group.rows)
        if (row.values.sourceLine) {
          const n = integer(row, 'sourceLine');
          if (n <= 0) fail('sourceLine', '原分录号必须是正整数');
          if (lineNos.has(n)) fail('sourceLine', '同一凭证的原分录号重复，请核对是否重复导出');
          lineNos.add(n);
        }
      if (lineNos.size && lineNos.size !== group.rows.length)
        fail('sourceLine', '同一凭证填写原分录号时，每行都应填写');
      if (lineNos.size) {
        const ordered = group.rows
          .map((row, index) => ({ row, line: group.lines[index]! }))
          .sort((a, b) => Number(a.row.values.sourceLine) - Number(b.row.values.sourceLine));
        group.rows = ordered.map((p) => p.row);
        group.lines = ordered.map((p) => p.line);
      }
      const digest = hash({
        original: group.original,
        date: group.date,
        attachments: group.attachments,
        note: group.note,
        lines: group.lines,
      });
      const duplicate = await svc.db
        .withTables<ImportTables>()
        .selectFrom('legacy_import_voucher')
        .selectAll()
        .where('fingerprint', '=', digest)
        .executeTakeFirst();
      if (duplicate)
        fail('number', '该原凭证此前已经导入过，请在迁移记录中核对原凭证；不会重复导入');
      const input: VoucherInput = {
        date: group.date,
        voucherTypeId: group.typeId,
        number: options.numbering === 'preserve' ? group.number : undefined,
        attachments: group.attachments,
        note: group.note,
        lines: group.lines,
      };
      const validated = VoucherInputSchema.safeParse(input);
      if (!validated.success) {
        for (const issue of validated.error.issues) {
          const row =
            issue.path[0] === 'lines' && typeof issue.path[1] === 'number'
              ? (group.rows[issue.path[1]] ?? group.row)
              : group.row;
          add(
            row,
            new CellError(
              String(issue.path.at(-1) ?? '凭证'),
              '凭证字段格式或长度不符合要求，请核对该列',
            ),
          );
        }
        continue;
      }
      if (
        options.numbering === 'preserve' &&
        (await svc.voucherPolicy.get()).numbering !== 'manual'
      )
        fail('number', '保留原凭证号需要账套采用手工编号，请管理员在账套参数中确认后重新预检');
      const voucher = await svc.vouchers.create(validated.data);
      await svc.db
        .withTables<ImportTables>()
        .insertInto('legacy_import_voucher')
        .values({
          fingerprint: digest,
          batch_id: batchId,
          original_key: group.original,
          voucher_id: voucher.id,
        })
        .execute();
      result.vouchers.push({
        original: group.original,
        id: voucher.id,
        displayNo: voucher.displayNo,
        location: group.row.location,
      });
      result.summary.vouchers++;
      result.summary.lines += group.lines.length;
    } catch (error) {
      const problems =
        error instanceof BusinessError
          ? (error.data.details?.problems as { line: number; message: string }[] | undefined)
          : undefined;
      if (problems)
        for (const p of problems)
          add(
            group.rows[p.line - 1] ?? group.row,
            new CellError(p.line ? '分录' : '凭证', p.message),
          );
      else add(group.row, error);
    }
  }
  if (!payload.rows.length)
    result.issues.push({
      file: '',
      sheet: '',
      row: 0,
      column: '',
      message: '没有可导入的数据，请选择导出文件或粘贴数据',
      severity: 'error',
    });
  if (result.summary.vouchers)
    result.issues.push({
      file: '',
      sheet: '凭证',
      row: 0,
      column: '审核状态',
      message:
        '新凭证保存为待审核。原制单、审核及过账信息保留在迁移来源中，请由操作员核对后审核、过账。',
      severity: 'warning',
    });
  return result;
}

export function legacyImportService(svc: CoreServices) {
  const db = svc.db.withTables<ImportTables>();
  const load = async (id: string, t = svc): Promise<BatchRow> => {
    const row = await t.db
      .withTables<ImportTables>()
      .selectFrom('legacy_import_batch')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || (row.owner_id !== t.user.id && !t.user.isAdmin))
      throw new BusinessError({
        code: 'IMPORT_NOT_FOUND',
        message: '找不到可访问的迁移批次，请刷新迁移记录',
      });
    return row;
  };
  return {
    async list(): Promise<ImportBatch[]> {
      assertAllowed(svc, 'legacy-import.view');
      let q = db
        .selectFrom('legacy_import_batch')
        .selectAll()
        .orderBy('created_at', 'desc')
        .limit(100);
      if (!svc.user.isAdmin) q = q.where('owner_id', '=', svc.user.id);
      return (await q.execute()).map(toBatch);
    },
    async get(id: string): Promise<ImportBatch> {
      assertAllowed(svc, 'legacy-import.view');
      return toBatch(await load(id));
    },
    async template() {
      assertAllowed(svc, 'legacy-import.view');
      return buildImportTemplate();
    },
    async prepare(raw: PrepareInput): Promise<ImportBatch> {
      assertAllowed(svc, 'legacy-import.prepare');
      const input = PrepareSchema.parse(raw),
        payload: ImportPayload = { rows: [], issues: [], files: [] };
      const names = new Set<string>();
      const contents = new Set<string>();
      for (const file of input.files) {
        if (names.has(file.name))
          throw new BusinessError({
            code: 'IMPORT_FILE_DUPLICATE',
            message: `文件名 ${file.name} 重复，请改名后再加入，便于准确定位问题`,
          });
        names.add(file.name);
        const contentHash = hash(file.contentBase64);
        if (contents.has(contentHash))
          throw new BusinessError({
            code: 'IMPORT_FILE_REPEATED',
            message: `文件 ${file.name} 与本批另一文件内容完全相同，请移除重复文件`,
          });
        contents.add(contentHash);
        const parsed = normalizeFile(
          file.name,
          await parseImportFile(file),
          file.columnMap,
          file.valueMap,
        );
        payload.rows.push(...parsed.rows);
        payload.issues.push(...parsed.issues);
        payload.files.push(...parsed.files);
      }
      if (payload.rows.length > 50_000)
        throw new BusinessError({
          code: 'IMPORT_TOO_MANY_ROWS',
          message: '本批超过5万行，请分批导入；每张凭证应放在同一批',
        });
      const now = svc.ctx.now().toISOString(),
        id = randomUUID();
      const summary = emptySummary();
      for (const row of payload.rows) if (row.kind !== 'vouchers') summary[row.kind]++;
      summary.lines = payload.rows.filter((r) => r.kind === 'vouchers').length;
      await svc.tx(async (t) => {
        const tdb = t.db.withTables<ImportTables>();
        await tdb
          .insertInto('legacy_import_batch')
          .values({
            id,
            name: input.name,
            owner_id: t.user.id,
            revision: 1,
            status: 'prepared',
            payload: JSON.stringify(payload),
            options: JSON.stringify(input.options),
            issues: JSON.stringify(payload.issues),
            summary: JSON.stringify(summary),
            fingerprint: null,
            receipt: null,
            created_at: now,
            updated_at: now,
          })
          .execute();
        for (const [index, file] of input.files.entries()) {
          await tdb
            .insertInto('legacy_import_source')
            .values({
              batch_id: id,
              file_index: index,
              name: file.name,
              content_base64: file.contentBase64,
            })
            .execute();
        }
      });
      return toBatch(await load(id));
    },
    async preflight(id: string): Promise<ImportBatch> {
      assertAllowed(svc, 'legacy-import.prepare');
      let checked: { result: RunResult; fingerprint: string; revision: number } | undefined;
      try {
        await svc.tx(async (t) => {
          const row = await load(id, t);
          if (row.status === 'completed') return;
          const target = await fingerprint(t);
          const result = await perform(
            t,
            JSON.parse(row.payload) as ImportPayload,
            JSON.parse(row.options) as ImportOptions,
            id,
          );
          checked = { result, fingerprint: target, revision: row.revision };
          throw new RolledBack(result);
        });
      } catch (error) {
        if (!(error instanceof RolledBack)) {
          if (error instanceof BusinessError) throw error;
          throw new BusinessError({
            code: 'IMPORT_CHECK_FAILED',
            message: '迁移预检未能完成，本批账务变更已回滚',
            hint: '暂存原文件仍保留，请检查数据与存储后重新预检',
          });
        }
      }
      if (checked) {
        const { result, fingerprint: target, revision } = checked;
        await db
          .updateTable('legacy_import_batch')
          .set({
            status: result.issues.some((i) => i.severity === 'error') ? 'failed' : 'checked',
            issues: JSON.stringify(result.issues),
            summary: JSON.stringify(result.summary),
            fingerprint: target,
            revision: revision + 1,
            updated_at: svc.ctx.now().toISOString(),
          })
          .where('id', '=', id)
          .where('revision', '=', revision)
          .where('status', '!=', 'completed')
          .execute();
      }
      return toBatch(await load(id));
    },
    async commit(id: string, revision: number, confirmed: boolean): Promise<ImportBatch> {
      assertAllowed(svc, 'legacy-import.execute');
      if (!confirmed)
        throw new BusinessError({
          code: 'IMPORT_CONFIRM_REQUIRED',
          message: '请核对预检汇总并明确确认导入',
        });
      try {
        await svc.tx(async (t) => {
          const row = await load(id, t);
          if (row.status === 'completed') return;
          if (row.revision !== revision || row.status !== 'checked' || !row.fingerprint)
            throw new BusinessError({
              code: 'IMPORT_CHECK_REQUIRED',
              message: '迁移数据尚未通过当前预检，请重新预检后导入',
            });
          if ((await fingerprint(t)) !== row.fingerprint)
            throw new BusinessError({
              code: 'IMPORT_TARGET_CHANGED',
              message: '预检后账套数据或参数已变化，请重新预检后再导入',
              hint: '已暂存的迁移资料仍然保留',
            });
          const result = await perform(
            t,
            JSON.parse(row.payload) as ImportPayload,
            JSON.parse(row.options) as ImportOptions,
            id,
          );
          if (result.issues.some((i) => i.severity === 'error')) throw new InvalidImport(result);
          const completedAt = t.ctx.now().toISOString();
          const receipt: ImportReceipt = {
            batchId: id,
            completedAt,
            summary: result.summary,
            vouchers: result.vouchers,
          };
          await t.log.write({
            action: 'legacy-import.execute',
            summary: `原账迁移「${row.name}」：科目${result.summary.accounts}、辅助档案${result.summary.dimensions}、期初${result.summary.opening}、凭证${result.summary.vouchers}张`,
            targetType: 'legacy_import_batch',
            targetId: id,
          });
          await t.db
            .withTables<ImportTables>()
            .updateTable('legacy_import_batch')
            .set({
              status: 'completed',
              revision: row.revision + 1,
              receipt: JSON.stringify(receipt),
              issues: JSON.stringify(result.issues),
              summary: JSON.stringify(result.summary),
              updated_at: completedAt,
            })
            .where('id', '=', id)
            .execute();
        });
      } catch (error) {
        // 正式事务已回滚，独立保存失败信息。输入资料不删除，允许修复目标后再预检。
        const failure =
          error instanceof BusinessError || error instanceof InvalidImport
            ? error
            : new BusinessError({
                code: 'IMPORT_SAVE_FAILED',
                message: '导入保存失败，本批账务变更已全部回滚',
                hint: '暂存原文件仍保留，请检查存储后重新预检再试',
              });
        const row = await load(id);
        if (row.status !== 'completed' && row.revision === revision) {
          const issues =
            error instanceof InvalidImport
              ? error.result.issues
              : [
                  ...(JSON.parse(row.issues) as ImportIssue[]),
                  {
                    file: '',
                    sheet: '',
                    row: 0,
                    column: '导入',
                    severity: 'error' as const,
                    message: failure.message,
                  },
                ];
          await db
            .updateTable('legacy_import_batch')
            .set({
              status: 'failed',
              fingerprint: null,
              issues: JSON.stringify(issues),
              revision: row.revision + 1,
              updated_at: svc.ctx.now().toISOString(),
            })
            .where('id', '=', id)
            .where('revision', '=', revision)
            .execute();
        }
        if (error instanceof InvalidImport)
          throw new BusinessError({
            code: 'IMPORT_INVALID',
            message: '导入校验未通过，本批账务变更已全部回滚',
            hint: '请打开迁移批次查看具体行列，修正后重新预检',
            details: { issues: error.result.issues },
          });
        throw failure;
      }
      return toBatch(await load(id));
    },
    async issuesExport(id: string) {
      assertAllowed(svc, 'legacy-import.view');
      const batch = toBatch(await load(id));
      const escape = (v: string | number) =>
        `"${String(v)
          .replace(/^[=+@\-\t\r]/, "'$&")
          .replace(/"/g, '""')}"`;
      const rows = [
        ['级别', '文件', '工作表', '原始行', '列', '问题'],
        ...batch.issues.map((i) => [
          i.severity === 'error' ? '错误' : '提醒',
          i.file,
          i.sheet,
          i.row,
          i.column,
          i.message,
        ]),
      ];
      return {
        name: '迁移问题清单.csv',
        contentBase64: Buffer.from(
          '\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n'),
          'utf8',
        ).toString('base64'),
      };
    },
    async sourceExport(id: string) {
      assertAllowed(svc, 'legacy-import.view');
      const row = await load(id);
      return buildSourceExport(
        JSON.parse(row.payload) as ImportPayload,
        row.receipt ? (JSON.parse(row.receipt) as ImportReceipt) : null,
      );
    },
    async originalExport(id: string, index: number) {
      assertAllowed(svc, 'legacy-import.view');
      await load(id);
      const file = await db
        .selectFrom('legacy_import_source')
        .selectAll()
        .where('batch_id', '=', id)
        .where('file_index', '=', index)
        .executeTakeFirst();
      if (!file)
        throw new BusinessError({
          code: 'IMPORT_SOURCE_NOT_FOUND',
          message: '找不到这份原始文件，请核对迁移批次',
        });
      return { name: file.name, contentBase64: file.content_base64 };
    },
  };
}
