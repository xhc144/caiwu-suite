import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { BusinessError, Decimal, sumCents as coreSumCents } from '@caiwu/core';
import { sql } from '@caiwu/db';
import type { CoreServices } from '@caiwu/core/server';
import {
  EXCHANGE_LIMITS,
  ExchangeDocumentSchema,
  ExchangeFileSchema,
  ExportDocumentsSchema,
  ImportDocumentsSchema,
  exchangeIdentity,
  type ExchangeDocument,
  type ExchangeFile,
  type ExchangeRelationsSchema,
  type ExchangeImportInput,
  type ExchangeIssue,
} from '../exchange';
import type { DocumentInput } from '../shared';
import type { InventoryTables } from './migrations';
import { e6, fail, inventoryService, quantity } from './service';
import { priceLine } from '../math';
import { nonnegativeImportOrder } from './import-order';
import {
  assertContractWithinPlan,
  contractFulfillment,
  withContractReversalHistory,
} from './contracts';

const secret = randomBytes(32);
type Relations = z.infer<typeof ExchangeRelationsSchema>;
const relationsOf = (file: ExchangeFile): Relations =>
  file.version === 2 ? file.relations : { transfers: [], reversals: [] };
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function sumCents(values: Iterable<number>) {
  try {
    return coreSumCents(values);
  } catch {
    fail('EXCHANGE_AMOUNT', '所选单据的金额合计超出允许范围', '请减少单据数量或核对金额后重试');
  }
}
type SavedImport = { hash: string; actorId: number; ids: number[] };
type PreviewRow = {
  index: number;
  key: string;
  number: string;
  date: string;
  kind: 'receipt' | 'issue';
  warehouseCode: string;
  category: string;
  operator: string;
  summary: string;
  accountCode: string | null;
  costAccountCode: string | null;
  taxRate: string;
  source: ExchangeDocument['source'];
  lines: ExchangeDocument['lines'];
  netCents: number;
  taxCents: number;
  grossCents: number;
};
function errorText(error: unknown) {
  return error instanceof BusinessError
    ? error.data.message
    : error instanceof Error
      ? error.message
      : '数据校验失败';
}
function validateRelations(file: ExchangeFile, errors: ExchangeIssue[]) {
  const relations = relationsOf(file);
  const docs = new Map(file.documents.map((d, i) => [d.key, { d, index: i + 1 }]));
  const used = new Set<string>();
  const pairs = (a: string, b: string) => {
    const left = docs.get(a),
      right = docs.get(b);
    if (!left || !right || a === b) {
      errors.push({
        document: left?.index ?? right?.index ?? 0,
        message: '调拨或反冲关联必须引用文件中两个不同的单据标识',
      });
      return null;
    }
    if (used.has(a) || used.has(b)) {
      errors.push({ document: left.index, message: '同一单据不能重复用于调拨、反冲或形成关联环' });
      return null;
    }
    used.add(a);
    used.add(b);
    return { left: left.d, right: right.d, index: left.index };
  };
  const stockSignature = (d: ExchangeDocument) => {
    const totals = new Map<string, bigint>();
    for (const l of d.lines)
      totals.set(l.productCode, (totals.get(l.productCode) ?? 0n) + BigInt(e6(l.quantity)));
    return JSON.stringify(
      [...totals]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, amount]) => [code, String(amount)]),
    );
  };
  const lineSignature = (d: ExchangeDocument) =>
    JSON.stringify(
      d.lines.map((l) => [
        l.productCode,
        new Decimal(l.quantity).toFixed(),
        new Decimal(l.unitPrice).toFixed(),
        l.priceIncludesTax,
        l.netCents,
        l.taxCents,
        l.grossCents,
      ]),
    );
  const transferNumbers = new Set<string>();
  for (const relation of relations.transfers) {
    const pair = pairs(relation.issueKey, relation.receiptKey);
    if (transferNumbers.has(relation.number))
      errors.push({
        document: pair?.index ?? 0,
        message: `文件中调拨单号 ${relation.number} 重复`,
      });
    transferNumbers.add(relation.number);
    if (!pair) continue;
    const { left: issue, right: receipt, index } = pair;
    if (
      issue.kind !== 'issue' ||
      receipt.kind !== 'receipt' ||
      issue.warehouseCode === receipt.warehouseCode ||
      issue.date !== receipt.date ||
      issue.category !== '其他出库' ||
      receipt.category !== '其他入库' ||
      !new Decimal(issue.taxRate).isZero() ||
      !new Decimal(receipt.taxRate).isZero() ||
      issue.lines.some((l) => l.priceIncludesTax) ||
      receipt.lines.some((l) => l.priceIncludesTax) ||
      !issue.accountCode ||
      issue.accountCode !== issue.costAccountCode ||
      issue.accountCode !== receipt.accountCode ||
      issue.accountCode !== receipt.costAccountCode ||
      issue.source !== null ||
      receipt.source !== null ||
      lineSignature(issue) !== lineSignature(receipt)
    )
      errors.push({
        document: index,
        message: `调拨 ${relation.number} 的出入方向、不同仓库、日期、对方科目、零税率、数量或金额不一致`,
      });
  }
  for (const relation of relations.reversals) {
    const pair = pairs(relation.originalKey, relation.reversalKey);
    if (!pair) continue;
    const { left: original, right: reversal, index } = pair;
    if (
      original.kind === reversal.kind ||
      original.warehouseCode !== reversal.warehouseCode ||
      reversal.date < original.date ||
      stockSignature(original) !== stockSignature(reversal) ||
      reversal.category !== (original.kind === 'receipt' ? '其他出库' : '其他入库') ||
      reversal.source?.type !== 'document' ||
      exchangeIdentity(reversal.source) !== exchangeIdentity(original)
    )
      errors.push({
        document: index,
        message: '反冲关联的方向、仓库、日期、产品数量或来源原单不一致',
      });
    if (
      original.kind === 'receipt' &&
      ((original.invoiceKind ?? 'none') !== (reversal.invoiceKind ?? 'none') ||
        new Decimal(original.taxRate).cmp(reversal.taxRate) !== 0 ||
        lineSignature(original) !== lineSignature(reversal))
    )
      errors.push({ document: index, message: '入库反冲必须保留原单的单价、含税口径、金额和税额' });
    if (
      original.kind === 'issue' &&
      (!new Decimal(reversal.taxRate).isZero() || reversal.lines.some((l) => l.priceIncludesTax))
    )
      errors.push({
        document: index,
        message: '出库反冲的退回入库应采用明确填写的不含税单价和零税率',
      });
  }
  return relations;
}
function parseFile(raw: unknown): { file: ExchangeFile | null; errors: ExchangeIssue[] } {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > EXCHANGE_LIMITS.bytes)
    return { file: null, errors: [{ document: 0, message: '单据文件不能超过 5 MB' }] };
  const parsed = ExchangeFileSchema.safeParse(raw);
  if (parsed.success) return { file: parsed.data, errors: [] };
  return {
    file: null,
    errors: parsed.error.issues.map((issue) => {
      const document =
        issue.path[0] === 'documents' && typeof issue.path[1] === 'number' ? issue.path[1] + 1 : 0;
      const at = issue.path.indexOf('lines');
      const position = at < 0 ? undefined : issue.path[at + 1];
      const line = typeof position === 'number' ? position + 1 : undefined;
      const field = String(issue.path.at(-1) ?? '文件');
      const label: Record<string, string> = {
        format: '文件类型',
        version: '文件版本',
        documents: '单据集合',
        warehouseCode: '仓库编码',
        number: '单号',
        date: '日期',
        category: '类别',
        accountCode: '收付款科目',
        costAccountCode: '成本科目',
        taxRate: '税率',
        productCode: '产品编号',
        quantity: '数量',
        unitPrice: '单价',
        priceIncludesTax: '含税口径',
        netCents: '金额',
        taxCents: '税额',
        grossCents: '价税合计',
      };
      return {
        document,
        line,
        message: /[\u4e00-\u9fff]/.test(issue.message)
          ? issue.message
          : `${label[field] ?? '单据字段'}缺失、包含未知字段或格式不正确`,
      };
    }),
  };
}

/** 对照 w_ck_rk/w_ck_ck 的头行转出；操作员、价格口径和来源用编码保留。 */
export async function exportDocuments(
  svc: CoreServices,
  raw: z.input<typeof ExportDocumentsSchema>,
): Promise<ExchangeFile> {
  return svc.tx(async (t) => {
    t.permissions.require('inventory.view');
    const { ids } = ExportDocumentsSchema.parse(raw);
    if (new Set(ids).size !== ids.length) fail('EXCHANGE_DUPLICATE', '转出集合包含重复单据');
    const s = inventoryService(t);
    const warehouses = await s.warehouses();
    const accounts = await t.accounts.list();
    const db = t.db.withTables<InventoryTables>();
    const keysById = new Map(ids.map((id, index) => [id, `document-${index + 1}`]));
    const selected = new Set(ids);
    const transfers = await db
      .selectFrom('inventory_transfer')
      .selectAll()
      .where((eb) =>
        eb.or([eb('issue_document_id', 'in', ids), eb('receipt_document_id', 'in', ids)]),
      )
      .orderBy('id')
      .execute();
    const reversals = await db
      .selectFrom('inventory_reversal')
      .selectAll()
      .where((eb) =>
        eb.or([eb('original_document_id', 'in', ids), eb('reversal_document_id', 'in', ids)]),
      )
      .orderBy('original_document_id')
      .execute();
    for (const pair of [
      ...transfers.map((r) => [r.issue_document_id, r.receipt_document_id]),
      ...reversals.map((r) => [r.original_document_id, r.reversal_document_id]),
    ]) {
      for (const id of pair)
        if (!selected.has(id!)) {
          const missing = await s.getDocument(id!);
          fail(
            'EXCHANGE_LINKED',
            `转出集合缺少关联${missing.kind === 'receipt' ? '入' : '出'}库单 ${missing.number}`,
            '请明确补选关联的另一张单据，再重新转出；不会自动扩大所选集合',
          );
        }
    }
    const documents: ExchangeDocument[] = [];
    for (const [i, id] of ids.entries()) {
      const d = await s.getDocument(id);
      let source: ExchangeDocument['source'] = null;
      if (d.source_type === 'document' && d.source_id) {
        const from = await s.getDocument(d.source_id);
        source = {
          type: 'document',
          kind: from.kind,
          warehouseCode: warehouses.find((w) => w.id === from.warehouse_id)!.code,
          number: from.number,
        };
      } else if (d.source_type === 'contract' && d.source_id) {
        const from = await db
          .selectFrom('inventory_contract')
          .select('number')
          .where('id', '=', d.source_id)
          .executeTakeFirst();
        if (!from) fail('EXCHANGE_SOURCE', `单据 ${d.number} 的来源合同不存在`);
        source = { type: 'contract', number: from.number };
      } else if (d.source_type === 'invoice') {
        fail(
          'EXCHANGE_SOURCE',
          `单据 ${d.number} 来自发票，库存文件不能单独迁移发票来源`,
          '请从转出集合中取消该单据，发票及来源出库需要通过发票业务一同办理',
        );
      } else if (d.source_type || d.source_id != null) {
        fail(
          'EXCHANGE_SOURCE',
          `单据 ${d.number} 含调拨或反冲关联，请通过对应业务处理后转出`,
          '请从转出集合中取消该单据，避免转出后失去成对关联',
        );
      }
      documents.push({
        key: `document-${i + 1}`,
        kind: d.kind,
        warehouseCode: warehouses.find((w) => w.id === d.warehouse_id)!.code,
        number: d.number,
        date: d.date,
        category: ExchangeDocumentSchema.shape.category.parse(d.category),
        operator: d.operator,
        summary: d.summary,
        accountCode:
          d.account_id == null ? null : accounts.find((a) => a.id === d.account_id)!.code,
        costAccountCode:
          d.cost_account_id == null ? null : accounts.find((a) => a.id === d.cost_account_id)!.code,
        taxRate: d.tax_rate,
        invoiceKind: d.invoice_kind,
        source,
        lines: d.lines.map((l) => ({
          productCode: l.productCode,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          priceIncludesTax: l.priceIncludesTax,
          note: l.note,
          netCents: l.net_cents,
          taxCents: l.tax_cents,
          grossCents: l.gross_cents,
        })),
      });
    }
    for (const key of ['netCents', 'taxCents', 'grossCents'] as const)
      sumCents(documents.flatMap((d) => d.lines.map((l) => l[key])));
    const content = {
      format: 'caiwu.inventory.documents',
      version: 2,
      documents,
      relations: {
        transfers: transfers.map((r) => ({
          number: r.number,
          issueKey: keysById.get(r.issue_document_id)!,
          receiptKey: keysById.get(r.receipt_document_id)!,
        })),
        reversals: reversals.map((r) => ({
          originalKey: keysById.get(r.original_document_id)!,
          reversalKey: keysById.get(r.reversal_document_id)!,
        })),
      },
    };
    const result = ExchangeFileSchema.safeParse(content);
    if (!result.success)
      fail(
        'EXCHANGE_EXPORT',
        '所选单据的数量、金额或字段超出文件格式限制',
        '请减少单据数量或核对原单',
      );
    if (Buffer.byteLength(JSON.stringify(result.data), 'utf8') > EXCHANGE_LIMITS.bytes)
      fail('EXCHANGE_SIZE', '所选单据文件超过 5 MB，不能转出', '请减少每批单据数量后分批转出');
    const errors: ExchangeIssue[] = [];
    validateRelations(result.data, errors);
    if (errors.length)
      fail('EXCHANGE_RELATION', errors[0]!.message, '请核对原单与成对关系后再转出');
    return result.data;
  });
}

/** 全批预览绑定库存版本；正式转入复核后新增全部单据或全部回滚。 */
export async function importDocuments(svc: CoreServices, raw: ExchangeImportInput, commit = false) {
  return svc.tx(async (t) => {
    t.permissions.require('inventory.import');
    t.permissions.require('inventory.edit');
    const v = ImportDocumentsSchema.parse(raw);
    const { file, errors } = parseFile(v.file);
    const rows: PreviewRow[] = [];
    const relations = file ? validateRelations(file, errors) : { transfers: [], reversals: [] };
    const shortages: {
      document: number;
      number: string;
      productCode: string;
      current: string;
      requested: string;
      difference: string;
    }[] = [];
    const savedIds: number[] = [];
    const result = (confirmation = '', saved = false) => ({
      rows,
      errors,
      shortages,
      confirmation,
      saved,
      savedIds,
      relations,
      totals: {
        netCents: sumCents(rows.map((r) => r.netCents)),
        taxCents: sumCents(rows.map((r) => r.taxCents)),
        grossCents: sumCents(rows.map((r) => r.grossCents)),
      },
    });
    if (!file) {
      if (commit)
        fail('EXCHANGE_FILE', '单据文件格式错误，未保存任何数据', '修正逐行错误后重新预览');
      return result();
    }
    const hash = createHash('sha256').update(JSON.stringify(file)).digest('hex');
    const requestSetting = `document-import.${v.requestKey}`;
    const done = await t.settings.get<SavedImport | null>(requestSetting, null);
    if (done) {
      if (done.hash !== hash || done.actorId !== t.user.id)
        fail(
          'EXCHANGE_REQUEST',
          '本次导入编号已经用于其他内容或操作员',
          '请重新选择文件发起新的导入',
        );
      for (const id of done.ids) await inventoryService(t).getDocument(id);
      if (commit) {
        savedIds.push(...done.ids);
        return result('', true);
      }
      errors.push({ document: 0, message: '本次导入已经保存，请刷新单据列表' });
      return result();
    }
    const s = inventoryService(t);
    const db = t.db.withTables<InventoryTables>();
    const warehouses = await s.warehouses();
    const accounts = await t.accounts.list();
    const products = await s.products();
    const context = await s.context();
    const periods = await t.periods.list();
    const inputs = new Map<string, DocumentInput>();
    const reversalByKey = new Map(
      relations.reversals.map((relation, index) => [relation.reversalKey, { relation, index }]),
    );
    const reversedKeys = new Set(relations.reversals.map((r) => r.originalKey));
    const sources = new Map<
      string,
      { imported?: string; id?: number; type: 'contract' | 'document' }
    >();
    const identities = new Map<string, ExchangeDocument>();
    const keys = new Set<string>();
    const contractRequests = new Map<number, Map<string, bigint>>();
    for (const relation of relations.transfers) {
      if (
        await db
          .selectFrom('inventory_transfer')
          .select('id')
          .where('number', '=', relation.number)
          .executeTakeFirst()
      )
        errors.push({ document: 0, message: `调拨单号 ${relation.number} 在当前账套中重复` });
    }
    for (const [i, d] of file.documents.entries()) {
      rows.push({
        index: i + 1,
        ...d,
        netCents: sumCents(d.lines.map((l) => l.netCents)),
        taxCents: sumCents(d.lines.map((l) => l.taxCents)),
        grossCents: sumCents(d.lines.map((l) => l.grossCents)),
      });
      const identity = exchangeIdentity(d);
      if (identities.has(identity))
        errors.push({ document: i + 1, message: '文件中同仓库、同方向单号重复' });
      identities.set(identity, d);
      if (keys.has(d.key)) errors.push({ document: i + 1, message: '文件内单据标识重复' });
      keys.add(d.key);
    }
    for (const [i, d] of file.documents.entries()) {
      try {
        const warehouse = warehouses.find((w) => w.code === d.warehouseCode);
        if (!warehouse) fail('WAREHOUSE', `仓库 ${d.warehouseCode} 不存在`, '请先维护同编码仓库');
        const resolveAccount = async (code: string | null) =>
          code == null ? null : (await t.accounts.require(code)).id;
        const input: DocumentInput = {
          kind: d.kind,
          warehouseId: warehouse.id,
          number: d.number,
          date: d.date,
          category: d.category,
          operator: d.operator,
          summary: d.summary,
          taxRate: d.taxRate,
          invoiceKind: d.invoiceKind ?? 'none',
          accountId: await resolveAccount(d.accountCode),
          costAccountId: await resolveAccount(d.costAccountCode),
          requestKey: `${v.requestKey}:${i + 1}`,
          lines: d.lines.map(({ netCents: _n, taxCents: _t, grossCents: _g, ...line }) => line),
        };
        for (const [j, line] of d.lines.entries()) {
          const calculated = priceLine(
            line.quantity,
            line.unitPrice,
            d.taxRate,
            line.priceIncludesTax,
          );
          if (
            calculated.net_cents !== line.netCents ||
            calculated.tax_cents !== line.taxCents ||
            calculated.gross_cents !== line.grossCents
          )
            errors.push({
              document: i + 1,
              line: j + 1,
              message: '金额、税额或价税合计与数量、单价、税率和含税口径不一致',
            });
        }
        if (d.source?.type === 'contract') {
          const contract = await db
            .selectFrom('inventory_contract')
            .selectAll()
            .where('number', '=', d.source.number)
            .executeTakeFirst();
          if (
            !contract ||
            contract.status !== 'open' ||
            contract.warehouse_id !== warehouse.id ||
            d.kind !== 'receipt'
          )
            fail('EXCHANGE_SOURCE', `来源合同 ${d.source.number} 不存在、已结束或仓库与方向不符`);
          sources.set(d.key, { type: 'contract', id: contract.id });
          input.sourceType = 'contract';
          input.sourceId = contract.id;
          // 完整反冲对保留真实头行，但原入库不再占用合同履约额度。
          // 关联校验失败时整批仍拒绝；单张原入库继续通过 prepare 的全部校验。
          if (!reversedKeys.has(d.key)) {
            const fulfillment = await contractFulfillment(t, contract.id);
            const requested = new Map(contractRequests.get(contract.id));
            for (const line of d.lines) {
              const total = (requested.get(line.productCode) ?? 0n) + BigInt(e6(line.quantity));
              const remaining = fulfillment.rows.find(
                (r) => r.productCode === line.productCode,
              )?.remaining;
              if (remaining == null || total > BigInt(e6(remaining)))
                fail(
                  'CONTRACT_EXCEEDED',
                  `来源合同 ${contract.number} 的产品 ${line.productCode} 整批入库超过未入库数量 ${remaining ?? '0'}`,
                  '请核对本文件全部合同入库单，减少数量后重新预览',
                );
              requested.set(line.productCode, total);
            }
            contractRequests.set(contract.id, requested);
          }
        } else if (d.source?.type === 'document') {
          const imported = identities.get(exchangeIdentity(d.source));
          if (imported) {
            if (
              imported.kind !== d.kind &&
              !relations.reversals.some(
                (r) => r.originalKey === imported.key && r.reversalKey === d.key,
              )
            )
              fail(
                'EXCHANGE_RELATION',
                '相反出入库方向的来源必须保留整单反冲关联',
                '请转出包含原单及反冲单的完整关联文件',
              );
            sources.set(d.key, { type: 'document', imported: imported.key });
          } else {
            const code = d.source.warehouseCode;
            const source = await db
              .selectFrom('inventory_document as d')
              .innerJoin('inventory_warehouse as w', 'w.id', 'd.warehouse_id')
              .select(['d.id', 'd.kind', 'd.source_type'])
              .where('w.code', '=', code)
              .where('d.kind', '=', d.source.kind)
              .where('d.number', '=', d.source.number)
              .executeTakeFirst();
            if (!source)
              fail('EXCHANGE_SOURCE', `来源单据 ${d.source.number} 不在文件或当前账套中`);
            if (source.source_type === 'invoice')
              fail(
                'EXCHANGE_SOURCE',
                '发票来源单不能作为普通库存文件的复制来源',
                '请从发票处理办理',
              );
            if (source.kind !== d.kind)
              fail('EXCHANGE_RELATION', '反冲来源原单必须包含在文件中并保留反冲关联');
            sources.set(d.key, { type: 'document', id: source.id });
            input.sourceType = 'document';
            input.sourceId = source.id;
          }
        }
        inputs.set(d.key, input);
      } catch (error) {
        errors.push({ document: i + 1, message: errorText(error) });
      }
    }
    const history = errors.length
      ? []
      : relations.reversals.flatMap((r) => {
          const receipt = inputs.get(r.originalKey),
            reversal = inputs.get(r.reversalKey);
          return receipt?.sourceType === 'contract' && reversal ? [{ receipt, reversal }] : [];
        });
    return withContractReversalHistory(t, history, commit, async () => {
      for (const [i, d] of file.documents.entries()) {
        const input = inputs.get(d.key);
        if (!input) continue;
        try {
          await s.prepare(input);
        } catch (error) {
          errors.push({ document: i + 1, message: errorText(error) });
          inputs.delete(d.key);
        }
      }
      const pending = [...file.documents];
      const ordered: ExchangeDocument[] = [];
      const visited = new Set<string>();
      const balances = new Map<number, Map<number, number>>();
      const initialBalances = new Map<number, Map<number, number>>();
      const movement = async (d: ExchangeDocument, apply: boolean) => {
        const input = inputs.get(d.key);
        if (!input) return [];
        const index = file.documents.indexOf(d) + 1;
        let balance = balances.get(input.warehouseId);
        if (!balance) {
          balance = await s.balances(input.warehouseId);
          balances.set(input.warehouseId, balance);
          initialBalances.set(input.warehouseId, new Map(balance));
        }
        const grouped = new Map<string, number>();
        for (const line of d.lines) {
          const total = (grouped.get(line.productCode) ?? 0) + e6(line.quantity);
          if (!Number.isSafeInteger(total)) fail('OVERFLOW', '导入单据的产品数量合计超出允许范围');
          grouped.set(line.productCode, total);
        }
        const missing: typeof shortages = [];
        for (const [code, n] of grouped) {
          const product = products.find((p) => p.code === code)!;
          const current = balance.get(product.id) ?? 0;
          const next = current + (d.kind === 'receipt' ? n : -n);
          if (!Number.isSafeInteger(next)) fail('OVERFLOW', '导入后的库存数量超出允许范围');
          if (d.kind === 'issue' && current < n)
            missing.push({
              document: index,
              number: d.number,
              productCode: code,
              current: quantity(current),
              requested: quantity(n),
              difference: quantity(n - current),
            });
          if (apply) balance.set(product.id, next);
        }
        return missing;
      };
      const originalIssues = new Set(
        relations.reversals
          .filter((r) => file.documents.find((d) => d.key === r.originalKey)?.kind === 'issue')
          .map((r) => r.originalKey),
      );
      const priority = (d: ExchangeDocument) =>
        d.kind === 'receipt' && reversalByKey.has(d.key)
          ? 0
          : originalIssues.has(d.key)
            ? 1
            : reversalByKey.has(d.key)
              ? 2
              : reversedKeys.has(d.key)
                ? 3
                : d.kind === 'receipt'
                  ? 4
                  : 5;
      while (pending.length) {
        const ready = pending
          .filter(
            (d) => !sources.get(d.key)?.imported || visited.has(sources.get(d.key)!.imported!),
          )
          .sort((a, b) => priority(a) - priority(b));
        if (!ready.length) {
          errors.push({ document: 0, message: '文件中的单据来源形成循环，不能转入' });
          break;
        }
        let chosen = ready[0]!;
        for (const d of ready)
          if (!(await movement(d, false)).length) {
            chosen = d;
            break;
          }
        shortages.push(...(await movement(chosen, true)));
        pending.splice(pending.indexOf(chosen), 1);
        ordered.push(chosen);
        visited.add(chosen.key);
      }
      if (shortages.length && !errors.length) {
        const stock = new Map(
          [...initialBalances].flatMap(([w, rows]) =>
            [...rows].map(([p, n]) => [`${w}:${p}`, n] as const),
          ),
        );
        const retry = nonnegativeImportOrder(
          file.documents.map((d) => {
            const input = inputs.get(d.key)!;
            const totals = new Map<string, number>();
            for (const l of input.lines) {
              const key = `${input.warehouseId}:${products.find((p) => p.code === l.productCode)!.id}`;
              totals.set(key, (totals.get(key) ?? 0) + e6(l.quantity));
            }
            return {
              key: d.key,
              parent: sources.get(d.key)?.imported,
              kind: d.kind,
              quantities: [...totals],
              priority: priority(d),
            };
          }),
          stock,
        );
        if (retry) {
          ordered.splice(
            0,
            ordered.length,
            ...retry.map((key) => file.documents.find((d) => d.key === key)!),
          );
          balances.clear();
          for (const [w, rows] of initialBalances) balances.set(w, new Map(rows));
          shortages.splice(0);
          for (const d of ordered) shortages.push(...(await movement(d, true)));
        }
      }
      const confirmation = createHmac('sha256', secret)
        .update(
          JSON.stringify({
            file,
            requestKey: v.requestKey,
            allowNegative: v.allowNegative,
            actor: t.user.id,
            book: context.book.id,
            control: context.control,
            warehouses,
            accounts,
            products,
            periods,
          }),
        )
        .digest('hex');
      if (!commit) return result(confirmation);
      if (errors.length)
        fail('EXCHANGE_ERRORS', '多单转入存在错误，未保存任何数据', '修正文件后重新预览');
      if (v.confirmation !== confirmation)
        fail(
          'EXCHANGE_VERSION',
          '转入预览已过期或库存、期间、档案已变化',
          '重新预览并核对后再确认转入',
        );
      if (shortages.length) {
        t.permissions.require('inventory.negative-stock');
        if (!v.allowNegative)
          fail(
            'EXCHANGE_NEGATIVE',
            '转入会造成负库存，尚未明确确认',
            '核对预览中的库存差额，默认取消',
          );
      }
      const importedIds = new Map<string, number>();
      for (const d of ordered) {
        const input = inputs.get(d.key)!;
        const source = sources.get(d.key);
        if (source) {
          input.sourceType = source.type;
          input.sourceId = source.imported ? importedIds.get(source.imported)! : source.id!;
        }
        const p = await s.previewDocument(input);
        if (p.shortages.length && v.allowNegative) input.negativeConfirmation = p.confirmation;
        const saved = await t.inventory.with((inventory) => inventory.saveDocument(input));
        importedIds.set(d.key, saved.id);
        const reversal = reversalByKey.get(d.key);
        if (reversal) {
          const { relation, index } = reversal;
          const originalId = importedIds.get(relation.originalKey)!;
          await db
            .insertInto('inventory_reversal')
            .values({
              original_document_id: originalId,
              reversal_document_id: saved.id,
              request_key: `${v.requestKey}:reversal:${index + 1}`,
              payload_hash: digest({ hash, relation }),
              created_by: t.user.id,
              created_at: t.ctx.now().toISOString(),
            })
            .execute();
          await db
            .updateTable('inventory_document')
            .set({ revision: sql`revision+1` })
            .where('id', '=', originalId)
            .execute();
        }
      }
      for (const [i, relation] of relations.transfers.entries()) {
        await db
          .insertInto('inventory_transfer')
          .values({
            number: relation.number,
            request_key: `${v.requestKey}:transfer:${i + 1}`,
            payload_hash: digest({ hash, relation }),
            issue_document_id: importedIds.get(relation.issueKey)!,
            receipt_document_id: importedIds.get(relation.receiptKey)!,
            revision: 1,
            created_by: t.user.id,
            created_at: t.ctx.now().toISOString(),
          })
          .execute();
      }
      for (const id of new Set(
        [...sources.values()].filter((s) => s.type === 'contract').map((s) => s.id!),
      ))
        await assertContractWithinPlan(t, id, '多单转入');
      savedIds.push(...file.documents.map((d) => importedIds.get(d.key)!));
      await t.settings.set(requestSetting, {
        hash,
        actorId: t.user.id,
        ids: savedIds,
      } satisfies SavedImport);
      await t.log.write({
        action: 'inventory.documents.import',
        summary: `转入 ${savedIds.length} 张出入库单`,
        detail: { transfers: relations.transfers.length, reversals: relations.reversals.length },
      });
      return result(confirmation, true);
    });
  });
}
