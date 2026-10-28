import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BusinessError, DIMENSION_TYPES, parseMoney, periodOfDate, zDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  BulkDeleteSchema,
  BulkDeleteCommitSchema,
  ImportSchema,
  ImportCommitSchema,
  type BulkDeleteInput,
  type ImportInput,
} from '../bulk-shared';
import { DocumentSchema, type DocumentInput } from '../shared';
import type { CashierTables } from './migrations';
import { assertOpen, cashierService, validateDocument } from './service';

const key = randomBytes(32);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tables = (svc: CoreServices) => svc.db.withTables<CashierTables>();
function fail(
  code: string,
  message: string,
  hint = '请重新检查文件或单据范围，再预览后确认',
): never {
  throw new BusinessError({
    code: `CASHIER_${code}`,
    message,
    hint,
    actions: [{ label: '出纳收付单', to: '/m/cashier/documents' }],
  });
}
const reason = (e: unknown) =>
  e instanceof BusinessError ? e.data.message : e instanceof Error ? e.message : '资料校验失败';
type Token = {
  bookId: string;
  userId: number;
  expires: number;
} & (
  { kind: 'delete'; rows: DeleteRow[] } | { kind: 'import'; inputHash: string; resultHash: string }
);
async function sign(
  svc: CoreServices,
  value:
    | { kind: 'delete'; rows: DeleteRow[] }
    | { kind: 'import'; inputHash: string; resultHash: string },
) {
  const data = Buffer.from(
    JSON.stringify({
      ...value,
      bookId: (await svc.book.info()).id,
      userId: svc.user.id,
      expires: svc.ctx.now().getTime() + 15 * 60 * 1000,
    }),
  ).toString('base64url');
  return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
}
async function verify(svc: CoreServices, token: string, kind: Token['kind']): Promise<Token> {
  const [data, signature, extra] = token.split('.');
  if (!data || !signature || extra) fail('BULK_PLAN', '预览凭据无效，请重新预览');
  const expected = createHmac('sha256', key).update(data).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    fail('BULK_PLAN', '预览凭据已失效，请重新预览');
  const value = JSON.parse(Buffer.from(data, 'base64url').toString()) as Token;
  if (
    value.kind !== kind ||
    value.bookId !== (await svc.book.info()).id ||
    value.userId !== svc.user.id ||
    value.expires < svc.ctx.now().getTime()
  )
    fail('BULK_PLAN', '预览已经过期或不属于当前账套、操作员，请重新预览');
  return value;
}

type DeleteRow = {
  id: number;
  revision: number;
  number: string;
  date: string;
  summary: string;
  amount: number;
  reason: string | null;
};
async function deletionReason(svc: CoreServices, id: number, revision: number) {
  const db = tables(svc);
  const row = await db
    .selectFrom('cashier_document')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row || row.deleted) return '单据已删除或不存在';
  if (row.revision !== revision) return '单据在预览后已修改，请刷新后重新选择';
  if (
    await db
      .selectFrom('cashier_match_document')
      .select('match_id')
      .where('document_id', '=', id)
      .executeTakeFirst()
  )
    return '单据已勾账，请先取消勾账';
  if (
    await db
      .selectFrom('cashier_batch_document')
      .select('voucher_id')
      .where('document_id', '=', id)
      .where('voucher_id', 'is not', null)
      .executeTakeFirst()
  )
    return '单据已生成凭证，请先撤销来源凭证';
  try {
    await assertOpen(svc, row.period);
    return null;
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    return reason(e);
  }
}
async function previewDelete(svc: CoreServices, raw: BulkDeleteInput) {
  const input = BulkDeleteSchema.parse(raw);
  const documents = input.selection
    ? (
        await tables(svc)
          .selectFrom('cashier_document')
          .select(['id', 'revision', 'date', 'summary', 'amount'])
          .where(
            'id',
            'in',
            input.selection.map((r) => r.id),
          )
          .where('deleted', '=', 0)
          .execute()
      ).map((d) => ({ ...d, number: `CN-${String(d.id).padStart(6, '0')}` }))
    : await cashierService(svc).documents(input.filter ?? {});
  const selected = input.selection ?? documents.map((d) => ({ id: d.id, revision: d.revision }));
  if (!selected.length) fail('BULK_EMPTY', '所选范围没有出纳单据');
  if (selected.length > 2000)
    fail('BULK_LIMIT', '本次范围超过两千张单据', '请缩小日期范围后分批操作');
  const rows: DeleteRow[] = [];
  for (const item of selected) {
    const d = documents.find((d) => d.id === item.id);
    rows.push({
      ...item,
      number: d?.number ?? `CN-${item.id}`,
      date: d?.date ?? '',
      summary: d?.summary ?? '',
      amount: d?.amount ?? 0,
      reason: await deletionReason(svc, item.id, item.revision),
    });
  }
  return {
    rows,
    eligible: rows.filter((r) => !r.reason).length,
    skipped: rows.filter((r) => r.reason).length,
    previewToken: await sign(svc, { kind: 'delete', rows }),
  };
}

type ImportRow = {
  line: number;
  date: string;
  summary: string;
  accountName: string;
  amount: number | null;
  foreignAmount: number | null;
  direction: 'receipt' | 'payment' | null;
  error: string | null;
  empty: boolean;
};
async function buildImport(svc: CoreServices, raw: ImportInput) {
  const input = ImportSchema.parse(raw);
  const accounts = await cashierService(svc).accounts();
  const rows: ImportRow[] = [];
  const documents: { line: number; data: DocumentInput }[] = [];
  const mapped = Object.values(input.mapping).filter((v) => v != null);
  if (new Set(mapped).size !== mapped.length)
    fail('IMPORT_MAPPING', '同一文件列不能同时映射到两个字段');
  if (input.mapping.date == null || input.mapping.summary == null)
    fail('IMPORT_MAPPING', '请指定日期列和摘要列');
  if (input.mapping.account == null && input.defaultAccountId == null)
    fail('IMPORT_MAPPING', '请指定账户列，或选择本次导入的出纳账户');
  const dims = new Map<string, Awaited<ReturnType<typeof svc.dimensions.items>>>();
  for (const type of DIMENSION_TYPES)
    if (input.mapping[type.id] != null) dims.set(type.id, await svc.dimensions.items(type.id));
  for (let i = 0; i < input.rows.length; i++) {
    const source = input.rows[i]!;
    const get = (field: keyof typeof input.mapping) => {
      const col = input.mapping[field];
      return col == null ? '' : (source[col] ?? '').trim();
    };
    const output: ImportRow = {
      line: i + 2,
      date: get('date'),
      summary: get('summary'),
      accountName: get('account'),
      amount: null,
      foreignAmount: null,
      direction: null,
      error: null,
      empty: source.every((s) => !s.trim()),
    };
    rows.push(output);
    if (output.empty) continue;
    try {
      const currency = get('currency');
      const candidates = accounts.filter(
        (a) =>
          (input.mapping.account == null
            ? a.id === input.defaultAccountId
            : a.name === get('account') || a.code === get('account')) &&
          (!currency || a.currency === currency),
      );
      if (candidates.length !== 1)
        throw new Error('出纳账户不存在或名称重复，请填写唯一账户名称并核对币种');
      const cash = candidates[0]!;
      output.accountName = cash.name;
      const date = zDate.parse(output.date.replaceAll('/', '-').replaceAll('.', '-'));
      const readAmount = (field: 'receipt' | 'payment' | 'amount' | 'foreignAmount') => {
        const text = get(field);
        if (!text) return 0;
        let value: number | null;
        try {
          value = parseMoney(text);
        } catch {
          throw new Error('金额超出可处理范围，请核对金额或拆分单据');
        }
        if (value == null || value < 0)
          throw new Error(`${field === 'foreignAmount' ? '原币' : '收付'}金额无效，请填写非负金额`);
        return value;
      };
      let amount: number;
      let direction: 'receipt' | 'payment';
      if (input.mapping.amount != null || input.mapping.direction != null) {
        if (input.mapping.amount == null || input.mapping.direction == null)
          throw new Error('金额列和收付方向列必须同时指定');
        if (input.mapping.receipt != null || input.mapping.payment != null)
          throw new Error('金额方向格式和收款付款格式请选择一种');
        amount = readAmount('amount');
        const text = get('direction');
        if (['收款', '收', '借', 'receipt'].includes(text)) direction = 'receipt';
        else if (['付款', '付', '贷', 'payment'].includes(text)) direction = 'payment';
        else throw new Error('收付方向应填写收款或付款');
      } else {
        const receipt = readAmount('receipt');
        const payment = readAmount('payment');
        if (receipt > 0 === payment > 0) throw new Error('每行应仅填写一项大于零的收款或付款金额');
        amount = receipt || payment;
        direction = receipt > 0 ? 'receipt' : 'payment';
      }
      const oppositeCode = get('oppositeAccount');
      const opposite = oppositeCode ? await svc.accounts.getByCode(oppositeCode) : null;
      if (oppositeCode && !opposite) throw new Error(`对方科目 ${oppositeCode} 不存在`);
      const dimensions = { ...input.defaultDimensions };
      for (const type of DIMENSION_TYPES) {
        if (input.mapping[type.id] == null) continue;
        const code = get(type.id);
        const item = (dims.get(type.id) ?? []).find((d) => d.code === code);
        if (code && !item) throw new Error(`${type.name}编码 ${code} 不存在`);
        dimensions[type.id] = item?.id ?? null;
      }
      const data = DocumentSchema.parse({
        accountId: cash.id,
        period: periodOfDate(date),
        date,
        summary: output.summary,
        direction,
        amount,
        oppositeAccountId: opposite?.id ?? null,
        dimensions,
        refNo: get('refNo'),
        note: get('note'),
        foreignAmount: get('foreignAmount') ? readAmount('foreignAmount') : null,
        exchangeRate: get('exchangeRate') || null,
      });
      await validateDocument(svc, data);
      output.date = date;
      output.amount = amount;
      output.foreignAmount = data.foreignAmount ?? null;
      output.direction = direction;
      documents.push({ line: output.line, data });
    } catch (e) {
      if (e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)) {
        output.error = e.issues
          .map((issue: { message: string; path?: (string | number)[] }) => {
            if (/[\u4e00-\u9fff]/.test(issue.message)) return issue.message;
            const field = issue.path?.[0];
            const label =
              field === 'summary'
                ? '摘要'
                : field === 'note'
                  ? '说明'
                  : field === 'refNo'
                    ? '票号'
                    : field === 'exchangeRate'
                      ? '汇率'
                      : '资料';
            return `${label}填写不正确或超出允许长度，请检查后重新导入`;
          })
          .join('；');
      } else output.error = reason(e);
    }
  }
  return { input, rows, documents };
}

type ImportReceipt = { inputHash: string; ids: number[]; count: number };
export const bulkService = (svc: CoreServices) => ({
  async previewDelete(raw: BulkDeleteInput) {
    svc.permissions.require('cashier.document.edit');
    return svc.tx((t) => previewDelete(t, raw));
  },
  async deleteDocuments(raw: z.input<typeof BulkDeleteCommitSchema>) {
    svc.permissions.require('cashier.document.edit');
    const input = BulkDeleteCommitSchema.parse(raw);
    return svc.tx(async (t) => {
      const plan = await verify(t, input.previewToken, 'delete');
      if (plan.kind !== 'delete') fail('BULK_PLAN', '删除预览凭据无效');
      const deleted: number[] = [];
      const skipped: DeleteRow[] = [];
      for (const row of plan.rows) {
        const currentReason = row.reason ?? (await deletionReason(t, row.id, row.revision));
        if (currentReason) {
          skipped.push({ ...row, reason: currentReason });
          continue;
        }
        await tables(t)
          .updateTable('cashier_document')
          .set({ deleted: 1, revision: row.revision + 1 })
          .where('id', '=', row.id)
          .execute();
        deleted.push(row.id);
      }
      await t.log.write({
        action: 'cashier.document.bulk-delete',
        summary: `批量删除出纳单 ${deleted.length} 张，跳过 ${skipped.length} 张`,
        detail: { deleted, skipped },
      });
      return { deleted, skipped };
    });
  },
  async previewImport(raw: ImportInput) {
    svc.permissions.require('cashier.document.edit');
    return svc.tx(async (t) => {
      const result = await buildImport(t, raw);
      const valid = result.documents.length;
      const errors = result.rows.filter((r) => r.error).length;
      return {
        rows: result.rows,
        valid,
        errors,
        empty: result.rows.filter((r) => r.empty).length,
        previewToken:
          valid && !errors
            ? await sign(t, {
                kind: 'import',
                inputHash: digest(result.input),
                resultHash: digest(result.documents),
              })
            : null,
      };
    });
  },
  async importDocuments(raw: z.input<typeof ImportCommitSchema>) {
    svc.permissions.require('cashier.document.edit');
    const input = ImportCommitSchema.parse(raw);
    const content = ImportSchema.parse(input);
    const inputHash = digest(content);
    return svc.tx(async (t) => {
      const old = await t.settings.get<ImportReceipt | null>(`import:${input.requestKey}`, null);
      if (old) {
        if (old.inputHash !== inputHash)
          fail('IDEMPOTENCY', '同一次导入请求的内容已改变', '重新选择文件并生成新的导入预览');
        return { ids: old.ids, count: old.count };
      }
      const plan = await verify(t, input.previewToken, 'import');
      if (plan.kind !== 'import' || plan.inputHash !== inputHash)
        fail('IMPORT_STALE', '文件内容或格式映射已经改变，请重新预览');
      const current = await buildImport(t, content);
      if (current.rows.some((r) => r.error) || !current.documents.length)
        fail('IMPORT_ERRORS', '导入资料校验未通过，未保存任何单据', '重新预览并逐行修正错误');
      if (plan.resultHash !== digest(current.documents))
        fail('IMPORT_STALE', '账户或辅助档案已经变化，请重新预览');
      const ids: number[] = [];
      for (const row of current.documents) {
        // 导入编号与原始文件行号固定绑定；整个导入在同一事务内保存。
        const requestKey = `import:${input.requestKey}:${row.line}`;
        const saved = await cashierService(t).createDocument({ ...row.data, requestKey });
        ids.push(saved.id);
      }
      await t.settings.set(`import:${input.requestKey}`, { inputHash, ids, count: ids.length });
      await t.log.write({
        action: 'cashier.document.import',
        summary: `导入 ${input.fileName}：${ids.length} 张出纳单`,
        detail: {
          ids,
          fileName: input.fileName,
          skippedEmpty: current.rows.filter((r) => r.empty).length,
        },
      });
      return { ids, count: ids.length };
    });
  },
});
