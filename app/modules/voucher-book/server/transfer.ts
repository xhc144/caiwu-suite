import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import ExcelJS, { type CellValue } from 'exceljs';
import {
  BusinessError,
  DIMENSION_TYPE_IDS,
  periodOfDate,
  zDate,
  type VoucherInput,
  type DimensionTypeId,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  ImportSchema,
  TransferSchema,
  TransferVoucherSchema,
  TRANSFER_FIELD_LABELS,
  type Transfer,
  type ImportInput,
  type BookFilter,
  type ActionResult,
  type CommitInput,
} from '../shared';
import {
  fail,
  checkedInput,
  finishPlan,
  loadPlan,
  requireVoucher,
  savePlan,
  selectedIds,
  trial,
  resultVoucher,
} from './service';

export const COLUMNS = [
  'key',
  'date',
  'type',
  'number',
  'attachments',
  'note',
  'line',
  'summary',
  'account',
  'project',
  'partner',
  'department',
  'person',
  'cashflow',
  'currency',
  'exchangeRate',
  'fcAmount',
  'quantity',
  'unitPrice',
  'debit',
  'credit',
  'settlement',
  'refNo',
  'bizDate',
] as const;
const HEADER_COLUMNS = ['key', 'date', 'type', 'number', 'attachments', 'note'] as const;
export async function transferData(svc: CoreServices, filter: BookFilter): Promise<Transfer> {
  const ids = await selectedIds(svc, { filter });
  const items = new Map((await svc.dimensions.items()).map((d) => [d.id, d.code]));
  const methods = new Map((await svc.reference.settlementMethods()).map((m) => [m.id, m.code]));
  const types = new Map((await svc.reference.voucherTypes()).map((t) => [t.id, t.code]));
  const vouchers: Transfer['vouchers'] = [];
  for (const id of ids) {
    const v = await requireVoucher(svc, id);
    vouchers.push({
      key: String(id),
      date: v.date,
      type: types.get(v.voucherTypeId)!,
      number: v.number,
      attachments: v.attachments,
      note: v.note,
      lines: v.lines.map((l) => ({
        summary: l.summary,
        account: l.accountCode,
        dimensions: Object.fromEntries(
          Object.entries(l.dimensions)
            .filter(([, id]) => id != null)
            .map(([type, id]) => [type, items.get(id!) ?? '']),
        ),
        debit: l.debit,
        credit: l.credit,
        currency: l.currency,
        exchangeRate: l.exchangeRate,
        fcAmount: l.fcAmount,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        settlement: l.settlementMethodId == null ? null : methods.get(l.settlementMethodId),
        refNo: l.refNo,
        bizDate: l.bizDate,
      })),
    });
  }
  return { format: 'caiwu-voucher-book', version: 1, vouchers };
}
export async function exportFile(svc: CoreServices, filter: BookFilter, format: 'json' | 'xlsx') {
  const data = await transferData(svc, filter);
  if (!data.vouchers.length) fail('EMPTY', '当前范围没有凭证可导出');
  if (format === 'json')
    return { file: JSON.stringify(data, null, 2), name: '凭证转出-v1.json', base64: false };
  const wb = new ExcelJS.Workbook();
  const meta = wb.addWorksheet('格式');
  meta.addRows([
    ['caiwu-voucher-book', 1],
    ['金额单位', '整数分'],
    ['说明', '一行对应一条分录，key 关联凭证头；导入后为当前操作员的新待审核凭证'],
  ]);
  const heads = wb.addWorksheet('凭证头');
  heads.addRow(HEADER_COLUMNS.map((k) => TRANSFER_FIELD_LABELS[k]!));
  for (const v of data.vouchers) heads.addRow(HEADER_COLUMNS.map((k) => v[k] ?? ''));
  const ws = wb.addWorksheet('凭证');
  ws.addRow(COLUMNS.map((k) => TRANSFER_FIELD_LABELS[k]!));
  for (const v of data.vouchers)
    for (const [i, l] of v.lines.entries()) {
      const row = { ...v, ...l, line: i + 1, ...l.dimensions };
      ws.addRow(COLUMNS.map((k) => (row as Record<string, unknown>)[k] ?? ''));
    }
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  return {
    file: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    name: '凭证导出-v1.xlsx',
    base64: true,
  };
}
function cellText(v: CellValue): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  fail('FILE', '文件含公式、富文本或其它不支持的单元格，请转为纯文本或数值后导入');
}
export async function parseFile(raw: ImportInput): Promise<Transfer> {
  const input = ImportSchema.parse(raw);
  if (input.format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(input.file) as unknown;
    } catch {
      fail('FILE', '结构化文本无法读取，请选择本模块 v1 转出文件');
    }
    const parsed = TransferSchema.safeParse(data);
    if (!parsed.success)
      fail('FILE', `文件格式或凭证字段不合法：${parsed.error.issues[0]?.message ?? ''}`);
    return parsed.data;
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Uint8Array.from(Buffer.from(input.file, 'base64')).buffer);
  } catch {
    fail('FILE', 'Excel 文件无法读取，请检查文件是否完整');
  }
  const ws = wb.getWorksheet('凭证') ?? wb.worksheets[0];
  const heads = wb.getWorksheet('凭证头');
  if (!ws || (ws.rowCount < 2 && (heads?.rowCount ?? 0) < 2))
    fail('EMPTY', '文件或所选范围没有数据');
  const header = ws.getRow(1).values;
  if (!Array.isArray(header)) fail('FILE', 'Excel 表头无法读取');
  const indices = new Map<string, number[]>();
  header.forEach((h, i) => {
    if (h != null) {
      const label = cellText(h);
      indices.set(label, [...(indices.get(label) ?? []), i]);
    }
  });
  const column = (name: string) => {
    const mapped = input.mapping?.[name];
    const names = mapped ? [mapped] : [...new Set([TRANSFER_FIELD_LABELS[name] ?? name, name])];
    const matches = names.flatMap((label) => indices.get(label) ?? []);
    if (matches.length > 1)
      fail(
        'MAPPING',
        `字段“${TRANSFER_FIELD_LABELS[name] ?? name}”匹配到多个表头，请明确映射到唯一列或修正重复表头`,
      );
    return matches[0];
  };
  const used = new Map<number, string>();
  for (const name of COLUMNS) {
    const index = column(name);
    if (index == null) continue;
    if (used.has(index))
      fail(
        'MAPPING',
        `字段“${TRANSFER_FIELD_LABELS[name]}”与“${TRANSFER_FIELD_LABELS[used.get(index)!]}”映射到同一列，请分别选择正确表头`,
      );
    used.set(index, name);
  }
  for (const required of ['key', 'date', 'type', 'account', 'debit', 'credit'])
    if (column(required) == null) fail('MAPPING', `字段 ${required} 未映射，请填写正确的表头名称`);
  const vouchers = new Map<string, Transfer['vouchers'][number]>();
  if (heads) {
    for (const [i, key] of HEADER_COLUMNS.entries())
      if (cellText(heads.getRow(1).getCell(i + 1).value) !== TRANSFER_FIELD_LABELS[key])
        fail('FILE', '凭证头工作表的格式不正确，请使用本模块v1格式');
    for (let n = 2; n <= heads.rowCount; n++) {
      const r = heads.getRow(n);
      if (!r.hasValues) continue;
      const rawHead = Object.fromEntries(
        HEADER_COLUMNS.map((key, i) => [key, cellText(r.getCell(i + 1).value)]),
      );
      const parsed = TransferVoucherSchema.safeParse({
        ...rawHead,
        number: rawHead.number === '' ? null : Number(rawHead.number),
        attachments: Number(rawHead.attachments),
        note: rawHead.note || null,
        lines: [],
      });
      if (!parsed.success)
        fail('FILE', `凭证头第${n}行格式不正确：${parsed.error.issues[0]?.message ?? ''}`);
      if (vouchers.has(parsed.data.key)) fail('FILE', `凭证头第${n}行的凭证分组重复`);
      vouchers.set(parsed.data.key, parsed.data);
    }
  }
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    if (!row.hasValues) continue;
    const text = (name: string) => {
      const c = column(name);
      return c == null ? '' : cellText(row.getCell(c).value);
    };
    const num = (name: string, fallback = 0) => {
      const s = text(name);
      if (s === '') return fallback;
      if (!/^-?\d+$/.test(s) || !Number.isSafeInteger(Number(s)))
        fail('FILE', `第${n}行 ${name} 必须是整数分或整数`);
      return Number(s);
    };
    const key = text('key');
    if (!key) fail('FILE', `第${n}行缺少凭证 key`);
    let v = vouchers.get(key);
    if (!v) {
      v = {
        key,
        date: text('date'),
        type: text('type'),
        number: text('number') === '' ? null : num('number'),
        attachments: num('attachments'),
        note: text('note') || null,
        lines: [],
      };
      vouchers.set(key, v);
    } else if (
      v.date !== text('date') ||
      v.type !== text('type') ||
      v.number !== (text('number') === '' ? null : num('number')) ||
      v.attachments !== num('attachments') ||
      v.note !== (text('note') || null)
    )
      fail('FILE', `第${n}行与同 key 凭证头不一致`);
    v.lines.push({
      summary: text('summary'),
      account: text('account'),
      dimensions: Object.fromEntries(
        DIMENSION_TYPE_IDS.map((t) => [t, text(t)]).filter(([, v]) => v),
      ),
      debit: num('debit'),
      credit: num('credit'),
      currency: text('currency') || null,
      exchangeRate: text('exchangeRate') || null,
      fcAmount: text('fcAmount') === '' ? null : num('fcAmount'),
      quantity: text('quantity') || null,
      unitPrice: text('unitPrice') || null,
      settlement: text('settlement') || null,
      refNo: text('refNo') || null,
      bizDate: text('bizDate') || null,
    });
  }
  const parsed = TransferSchema.safeParse({
    format: 'caiwu-voucher-book',
    version: 1,
    vouchers: [...vouchers.values()],
  });
  if (!parsed.success) fail('FILE', `文件内容不合法：${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}
type ImportRow = {
  key: string;
  label: string;
  errors: string[];
  input: VoucherInput | null;
  replacement: { id: number; revision: number; label: string } | null;
};
export type ImportPreview = {
  token: string;
  rows: {
    key: string;
    label: string;
    errors: string[];
    replacement: { id: number; revision: number; label: string } | null;
  }[];
  validCount: number;
  errorCount: number;
  stopped: boolean;
  onlyValid: boolean;
};
type ImportPlan = { rows: ImportRow[]; preview: ImportPreview; metadata: string };
async function importMetadata(svc: CoreServices) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        accounts: await svc.accounts.list(),
        dimensions: await svc.dimensions.items(),
        types: await svc.reference.voucherTypes(),
        methods: await svc.reference.settlementMethods(),
        currencies: await svc.reference.currencies(),
      }),
    )
    .digest('hex');
}
function errorTexts(e: unknown): string[] {
  if (e instanceof BusinessError) {
    const p = z
      .array(z.object({ line: z.number(), message: z.string() }))
      .safeParse(e.data.details?.problems);
    if (p.success) return p.data.map((x) => `${x.line ? `第${x.line}行：` : ''}${x.message}`);
    return [e.data.message];
  }
  return [e instanceof Error ? e.message : '数据校验失败'];
}
export async function importPreview(svc: CoreServices, raw: ImportInput): Promise<ImportPreview> {
  const input = ImportSchema.parse(raw);
  const data = await parseFile(input);
  const selected = data.vouchers.slice(input.from - 1, input.to);
  if (!selected.length) fail('EMPTY', '所选范围没有凭证');
  return svc.tx(async (t) => {
    const types = await t.reference.voucherTypes();
    const rows: ImportRow[] = [];
    const numbers = new Set<string>(),
      keys = new Set<string>();
    for (const [idx, v] of selected.entries()) {
      const errors: string[] = [];
      if (keys.has(v.key)) errors.push('文件内凭证 key 重复');
      keys.add(v.key);
      let generated: VoucherInput | null = null;
      let replacement: ImportRow['replacement'] = null;
      try {
        let date = input.targetDate ?? v.date;
        if (input.keepDay) {
          if (!input.targetDate || !zDate.safeParse(v.date).success)
            fail('DATE', '保留原日必须提供目标日期和有效原日期');
          date = `${input.targetDate.slice(0, 7)}-${v.date.slice(8, 10)}`;
        }
        if (!zDate.safeParse(date).success) fail('DATE', `目标日期 ${date} 不存在，请核对年月日`);
        const type = input.voucherTypeId
          ? types.find((x) => x.id === input.voucherTypeId)
          : types.find((x) => x.code === v.type);
        if (!type || type.disabled) fail('TYPE', `凭证类型 ${v.type} 不存在或已停用`);
        const number =
          input.numbering === 'auto'
            ? undefined
            : input.numbering === 'original'
              ? v.number
              : (input.start ?? 1) + idx;
        if (number != null && (number > 10000 || number < 1))
          fail('NUMBER', '手工导入的凭证编号必须在1至10000之间');
        if (input.numbering === 'original' && number == null)
          fail('NUMBER', '原凭证无编号，请选择自动编号');
        const numberKey = `${date.slice(0, 7)}:${type.id}:${number}`;
        if (number != null && numbers.has(numberKey)) fail('DUPLICATE', '导入批次内凭证编号重复');
        if (number != null) numbers.add(numberKey);
        const lines = [];
        for (const [i, l] of v.lines.entries()) {
          const account = await t.accounts.getByCode(l.account);
          if (!account || !account.isLeaf || account.disabled) {
            errors.push(`第${i + 1}行科目 ${l.account} 不存在、非末级或已停用`);
            continue;
          }
          const dimensions: Partial<Record<DimensionTypeId, number>> = {};
          for (const [type, code] of Object.entries(l.dimensions)) {
            if (!DIMENSION_TYPE_IDS.includes(type as DimensionTypeId)) {
              errors.push(`第${i + 1}行辅助类型 ${type} 非法`);
              continue;
            }
            const item = await t.dimensions.getByCode(type as DimensionTypeId, code);
            if (!item || !item.isLeaf || item.disabled) {
              errors.push(`第${i + 1}行辅助项 ${type}:${code} 不存在、非末级或已停用`);
              continue;
            }
            dimensions[type as DimensionTypeId] = item.id;
          }
          const settlement = l.settlement
            ? (await t.reference.settlementMethods()).find(
                (m) => m.code === l.settlement && !m.disabled,
              )
            : null;
          if (l.settlement && !settlement)
            errors.push(`第${i + 1}行结算方式 ${l.settlement} 不存在或已停用`);
          lines.push({
            ...l,
            accountId: account.id,
            dimensions,
            settlementMethodId: settlement?.id,
          });
        }
        generated = checkedInput({
          date,
          voucherTypeId: type.id,
          number,
          attachments: v.attachments,
          note: v.note,
          lines,
        });
        if (number != null) {
          const existing = await t.db
            .selectFrom('voucher')
            .select('id')
            .where('period', '=', periodOfDate(date))
            .where('voucher_type_id', '=', type.id)
            .where('number', '=', number)
            .executeTakeFirst();
          if (existing) {
            const old = await requireVoucher(t, existing.id);
            if (old.source)
              fail(
                'SOURCE',
                `已有同号 ${old.displayNo} 来自 ${old.source.module}，不能通过导入覆盖`,
              );
            if (old.status !== 'pending' || old.voided)
              fail('LOCKED', `已有同号 ${old.displayNo} 已审核/过账、作废或不是待审核，不能覆盖`);
            if (!input.overwritePending)
              fail(
                'NUMBER_TAKEN',
                `已经有编号为 ${number} 的待审核凭证；需要覆盖时请单独选择覆盖并重新预览`,
              );
            await t.permissions.require('voucher-book.overwrite');
            replacement = {
              id: old.id,
              revision: old.revision,
              label: `${old.date} ${old.displayNo}（版本 ${old.revision}）`,
            };
          }
        }
        if (errors.length) {
          generated = null;
        } else
          await trial(t, async (test) => {
            if (replacement)
              await test.vouchers.update(replacement.id, generated!, {
                expectedRevision: replacement.revision,
              });
            else await test.vouchers.create(generated!);
          });
      } catch (e) {
        errors.push(...errorTexts(e));
        generated = null;
      }
      rows.push({
        key: v.key,
        label: `${v.date} ${v.type}-${v.number ?? '草稿'}`,
        errors,
        input: generated,
        replacement,
      });
    }
    const errorCount = rows.reduce((s, r) => s + r.errors.length, 0);
    const result: ImportPreview = {
      token: randomUUID(),
      rows: rows.map(({ key, label, errors, replacement }) => ({
        key,
        label,
        errors,
        replacement,
      })),
      validCount: rows.filter((r) => !r.errors.length).length,
      errorCount,
      stopped: errorCount > 100,
      onlyValid: input.onlyValid ?? false,
    };
    await savePlan(
      t,
      'import',
      { rows, preview: result, metadata: await importMetadata(t) } satisfies ImportPlan,
      result.token,
    );
    return result;
  });
}
export async function importCommit(svc: CoreServices, input: CommitInput): Promise<ActionResult> {
  if (!input.confirmed) fail('CONFIRM', '请先预览并确认导入');
  return svc.tx(async (t) => {
    await t.permissions.require('voucher-book.import');
    const saved = await loadPlan(t, input.token);
    if (saved.action !== 'import') fail('PLAN', '该预览不属于导入');
    if (saved.result) return JSON.parse(saved.result) as ActionResult;
    const plan = JSON.parse(saved.payload) as ImportPlan;
    if (plan.metadata !== (await importMetadata(t)))
      fail('STALE', '科目、辅助档案或凭证类型已变化，请重新映射并预览导入');
    if (plan.preview.stopped)
      fail(
        'TOO_MANY_ERRORS',
        `共 ${plan.preview.errorCount} 处错误，超过100项，停止写入。请下载或复制错误清单修正文件`,
      );
    if (plan.preview.errorCount && !plan.preview.onlyValid)
      fail('IMPORT_ERRORS', '文件仍有错误，请修正或明确选择只导入完全合法的凭证并重新预览');
    const valid = plan.rows.filter((r) => !r.errors.length && r.input);
    if (!valid.length) fail('EMPTY', '没有完全合法的凭证可导入');
    const createdIds: number[] = [];
    for (const r of valid) {
      if (r.replacement) {
        await t.permissions.require('voucher-book.overwrite');
        if (!input.overwriteConfirmed) fail('OVERWRITE_CONFIRM', '请明确确认覆盖清单与原凭证版本');
        const old = await requireVoucher(t, r.replacement.id);
        if (
          old.source ||
          old.status !== 'pending' ||
          old.voided ||
          old.revision !== r.replacement.revision
        )
          fail('STALE', `${r.replacement.label} 已变化或不可覆盖，请重新预览`);
        await t.periods.assertOpen(old.period, '导入覆盖凭证');
        createdIds.push(
          (
            await t.vouchers.update(old.id, checkedInput(r.input!), {
              expectedRevision: r.replacement.revision,
            })
          ).id,
        );
      } else createdIds.push((await t.vouchers.create(checkedInput(r.input!))).id);
    }
    const imported = new Map(valid.map((r, i) => [r.key, createdIds[i]!]));
    const result: ActionResult = {
      successCount: createdIds.length,
      skippedCount: plan.rows.length - createdIds.length,
      createdIds,
      message: `导入 ${createdIds.length} 张，跳过 ${plan.rows.length - createdIds.length} 张`,
      rows: await Promise.all(
        plan.rows.map(async (r) => {
          const id = imported.get(r.key);
          return {
            key: r.key,
            label: r.label,
            outcome: id == null ? ('skipped' as const) : ('success' as const),
            reasons: r.errors,
            ...(id == null
              ? { voucherId: null, voucherLabel: null, status: '未导入' }
              : await resultVoucher(t, id)),
          };
        }),
      ),
    };
    await finishPlan(t, input.token, result);
    await t.log.write({
      action: 'voucher-book.import',
      summary: result.message,
      detail: { keys: valid.map((r) => r.key), createdIds },
    });
    return result;
  });
}
