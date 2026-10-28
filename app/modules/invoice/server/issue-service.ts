import { createHash } from 'node:crypto';
import {
  BusinessError,
  Decimal,
  normalizeDecimal,
  periodOfDate,
  type InvoiceIssueInput,
  type InvoiceIssueReferencesInput,
} from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { IssueOptionsSchema, type IssueOptions, type IssueSave } from '../shared';
import type { InvoiceTables } from './migrations';
import { invoiceService } from './service';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(
  code: string,
  message: string,
  hint = '核对发票、产品与出库参数，重新预览后操作',
): never {
  throw new BusinessError({
    code: `INVOICE_ISSUE_${code}`,
    message,
    hint,
    actions: [{ label: '发票转出库', to: '/m/invoice/issue' }],
  });
}
export function invoiceIssueService(svc: CoreServices) {
  const db = svc.db.withTables<InvoiceTables>();
  const assertProduct = async () => {
    if ((await svc.book.info()).product !== 'chengben')
      fail('PRODUCT', '当前账套未启用库存业务', '请在成本会计账套使用发票转出库');
  };
  const assertAccount = async (id: number, label: string) => {
    const account = await svc.accounts.require(id);
    if (!account.isLeaf || account.disabled) fail('ACCOUNT', `${label}必须为可用末级科目`);
    return account;
  };
  const references = async (input: InvoiceIssueReferencesInput = {}) => {
    await assertProduct();
    if (typeof svc.inventory.invoiceIssueReferences !== 'function')
      fail(
        'CAPABILITY',
        '当前安装版本缺少发票出库的仓库和产品目录',
        '请安装包含发票出库功能的完整版本，不需要输入内部记录号',
      );
    return svc.inventory.invoiceIssueReferences(input);
  };
  const details = async (invoiceId: number, invoiceRevision: number) => {
    await assertProduct();
    const { r, d } = (
      await invoiceService(svc).selected([{ id: invoiceId, revision: invoiceRevision }])
    )[0]!;
    if (d.direction !== 'output') fail('DIRECTION', '只有销项发票可以转出库');
    if (d.invoiceStatus !== 'normal') fail('VOID', '作废发票不能转出库');
    if (r.group_id != null || r.state === 'generated')
      fail(
        'VOUCHER',
        '此发票已经生成凭证，不能再直接转出库',
        '先核对是否需要撤销原来源凭证，避免重复确认收入',
      );
    if (r.state !== 'audited' && r.state !== 'issued')
      fail('AUDIT', '发票尚未审核，不能转出库', '先审核销项发票，再预览出库单');
    if (!d.lines.length)
      fail(
        'LINES',
        '只有汇总金额的发票不能转出库',
        '请补齐真实商品明细，不能用汇总金额编造产品和数量',
      );
    if (
      d.amount < 0 ||
      d.tax < 0 ||
      d.total < 0 ||
      d.lines.some(
        (l) =>
          l.amount < 0 ||
          l.tax < 0 ||
          l.total < 0 ||
          (l.quantity != null && new Decimal(l.quantity).isNegative()),
      )
    )
      fail(
        'RED',
        '红字发票转出库尚不支持',
        '请保留原红字发票；库存退货与成本回冲接通后再处理，不得改为正数出库',
      );
    for (const [index, line] of d.lines.entries()) {
      if (
        line.quantity == null ||
        line.unitPrice == null ||
        !new Decimal(line.quantity).isPositive()
      )
        fail(
          'QUANTITY',
          `第 ${index + 1} 行需要真实的正数量和单价`,
          '请核对原票商品明细；无实物数量的劳务票请使用发票制证',
        );
      if (!line.unit.trim())
        fail('UNIT', `第 ${index + 1} 行缺少计量单位`, '请补齐与库存产品一致的计量单位');
    }
    const issue = await db
      .selectFrom('invoice_issue')
      .selectAll()
      .where('invoice_id', '=', r.id)
      .executeTakeFirst();
    if ((r.state === 'issued') !== !!issue)
      fail('SOURCE', '发票与原出库单关联不完整', '请核对来源关联，不能覆盖或另建重复出库单');
    const mapping = await invoiceService(svc).settings('output');
    return {
      invoice: { ...d, id: r.id, revision: r.revision, state: r.state },
      issue: issue ?? null,
      previousInput: issue ? (JSON.parse(issue.input) as InvoiceIssueInput) : null,
      defaults: {
        settlementAccountId:
          mapping?.settlementMode === 'unified' ? mapping.settlement.accountId : undefined,
        salesAccountId: mapping?.business.accountId,
      },
    };
  };
  const prepare = async (raw: IssueOptions) => {
    const options = IssueOptionsSchema.parse(raw);
    const { invoice, issue } = await details(options.invoiceId, options.invoiceRevision);
    svc.permissions.require('inventory.edit');
    if (issue && !options.regenerate)
      fail(
        'DUPLICATE',
        '此发票已转出库，不能重复生成',
        '勾选重新生成并核对原出库单；已审核或核算的单据不能替换',
      );
    if (!issue && options.regenerate)
      fail('SOURCE', '此发票没有原出库单，无需重新生成', '取消重新生成选项后预览');
    await svc.periods.assertWritable({
      period: periodOfDate(options.date),
      oldPeriod: issue ? periodOfDate(issue.date) : undefined,
      mode: 'business',
      action: '发票转出库',
    });
    await assertAccount(options.settlementAccountId, '结算科目');
    await assertAccount(options.costAccountId, '销售成本科目');
    const refs = await references({ invoiceId: invoice.id });
    if (issue && refs.originalDocument?.id !== issue.inventory_document_id)
      fail('SOURCE', '库存原单与发票来源关联不一致', '请核对原出库单，不能覆盖其他来源或重复出库');
    if (!issue && refs.originalDocument)
      fail('SOURCE', '库存已有此发票的来源出库单，但发票关联缺失', '请核对来源关联，不能重复出库');
    if (
      !refs.warehouses.some(
        (warehouse: Awaited<ReturnType<typeof references>>['warehouses'][number]) =>
          warehouse.id === options.warehouseId,
      )
    )
      fail('WAREHOUSE', '所选仓库不存在或已停用', '重新选择可用仓库后预览');
    if (
      options.products.length !== invoice.lines.length ||
      new Set(options.products.map((p) => p.lineNo)).size !== options.products.length ||
      options.products.some((p) => p.lineNo > invoice.lines.length)
    )
      fail('MAPPING', '产品匹配必须逐行完整且不能重复', '逐行核对原发票商品与产品编码');
    const newProducts: InvoiceIssueInput['newProducts'] = [];
    const lines: InvoiceIssueInput['lines'] = [];
    for (const [index, line] of invoice.lines.entries()) {
      const choice = options.products.find((p) => p.lineNo === index + 1)!;
      const existingProduct = refs.products.find(
        (product: Awaited<ReturnType<typeof references>>['products'][number]) =>
          product.code === choice.productCode,
      );
      if (choice.create) {
        if (existingProduct)
          fail(
            'NEW_PRODUCT',
            `产品编码 ${choice.productCode} 已存在，不能按新增覆盖`,
            '选择已有产品或更换新产品编码',
          );
        if (choice.inventoryAccountId == null || choice.salesAccountId == null)
          fail('NEW_PRODUCT', `第 ${index + 1} 行新增产品需要存货和收入科目`);
        await assertAccount(choice.inventoryAccountId, '新产品存货科目');
        await assertAccount(choice.salesAccountId, '新产品收入科目');
        const product = {
          code: choice.productCode,
          name: line.name.trim(),
          specification: line.specification.trim(),
          unit: line.unit.trim(),
          inventoryAccountId: choice.inventoryAccountId,
          salesAccountId: choice.salesAccountId,
        };
        const repeated = newProducts.find((p) => p.code === product.code);
        if (repeated && digest(repeated) !== digest(product))
          fail(
            'NEW_PRODUCT',
            '同一新产品编码对应了不同名称、规格、单位或科目',
            '修正产品编码和逐行匹配，不会自动覆盖档案',
          );
        if (!repeated) newProducts.push(product);
      } else {
        if (!existingProduct || existingProduct.disabled)
          fail('PRODUCT', `第 ${index + 1} 行产品不存在或已停用`, '重新读取产品目录并选择可用产品');
        if (existingProduct.unit.trim() !== line.unit.trim())
          fail(
            'UNIT',
            `第 ${index + 1} 行产品单位与原票不一致`,
            '本次不作单位换算，请核对原票和产品档案',
          );
        if (
          existingProduct.name.trim() !== line.name.trim() ||
          existingProduct.specification.trim() !== line.specification.trim()
        )
          fail(
            'MATCH',
            `第 ${index + 1} 行产品名称或规格与原票不一致`,
            '选择名称、规格及单位一致的产品，或确认新增真实产品档案',
          );
        if (existingProduct.inventoryAccountId == null || existingProduct.salesAccountId == null)
          fail(
            'ACCOUNT',
            `第 ${index + 1} 行产品尚未配置存货或收入科目`,
            '到库存产品档案补齐有效科目后，重新读取目录并预览',
          );
        await assertAccount(existingProduct.inventoryAccountId, '已有产品存货科目');
        await assertAccount(existingProduct.salesAccountId, '已有产品收入科目');
      }
      const taxRate = line.taxMark === 'exempt' ? '0' : (line.taxRate ?? choice.taxRate);
      if (taxRate == null || new Decimal(taxRate).lt(0) || new Decimal(taxRate).gt(1))
        fail('RATE', `第 ${index + 1} 行需要明确的税率`, '按原票填写税率；未注明税率不能自动推定');
      if (
        choice.taxRate != null &&
        line.taxRate != null &&
        !new Decimal(choice.taxRate).eq(line.taxRate)
      )
        fail('RATE', `第 ${index + 1} 行不能改写原票税率`);
      lines.push({
        productCode: choice.productCode,
        quantity: line.quantity!,
        unitPrice: line.unitPrice!,
        // 发票存小数税率，库存 priceLine 使用百分数；只转换单位，不改写票面整数分。
        taxRate: normalizeDecimal(new Decimal(taxRate).mul(100).toFixed()),
        netCents: line.amount,
        taxCents: line.tax,
        totalCents: line.total,
      });
    }
    const input: InvoiceIssueInput = {
      invoiceId: invoice.id,
      invoiceRevision: invoice.revision,
      requestKey: options.requestKey,
      redLetter: false,
      warehouseId: options.warehouseId,
      date: options.date,
      number: options.number,
      settlementAccountId: options.settlementAccountId,
      costAccountId: options.costAccountId,
      originalDocument: issue
        ? { id: refs.originalDocument!.id, revision: refs.originalDocument!.revision }
        : null,
      newProducts,
      lines,
    };
    return { options, input, invoice, issue, fingerprint: digest({ input, invoice, issue }) };
  };
  return {
    details,
    prepare,
    references,
    async preview(options: IssueOptions) {
      const prepared = await prepare(options);
      if (typeof svc.inventory.previewInvoiceIssue !== 'function')
        fail(
          'CAPABILITY',
          '当前安装版本缺少发票出库服务',
          '请安装包含发票出库功能的完整版本后重新预览',
        );
      const plan = await svc.inventory.previewInvoiceIssue(prepared.input);
      return { ...prepared, plan };
    },
    async save(raw: IssueSave) {
      return svc.tx(async (tsvc) => {
        tsvc.permissions.require('invoice.issue');
        tsvc.permissions.require('inventory.edit');
        const tdb = tsvc.db.withTables<InvoiceTables>();
        const payloadHash = digest(raw);
        const repeated = await tdb
          .selectFrom('invoice_issue_request')
          .selectAll()
          .where('request_key', '=', raw.options.requestKey)
          .executeTakeFirst();
        if (repeated) {
          if (repeated.payload_hash !== payloadHash)
            fail('RETRY', '同一请求编号不能用于不同的出库输入', '刷新预览后重新提交');
          const current = await tdb
            .selectFrom('invoice_issue')
            .select(['input', 'inventory_document_id'])
            .where('id', '=', repeated.issue_id)
            .executeTakeFirst();
          const saved = JSON.parse(repeated.result) as {
            id: number;
            revision: number;
            issueId: number;
          };
          if (
            !current ||
            (JSON.parse(current.input) as InvoiceIssueInput).requestKey !==
              raw.options.requestKey ||
            current.inventory_document_id !== saved.id
          )
            fail(
              'RETRY_OLD',
              '此出库请求对应的单据已经后续重新生成',
              '重新打开当前来源单据，不复用旧请求',
            );
          return saved;
        }
        const prepared = await invoiceIssueService(tsvc).prepare(raw.options);
        if (prepared.fingerprint !== raw.fingerprint)
          fail('STALE', '发票或原出库关联已变化，不能使用旧预览', '重新预览后核对产品与金额');
        if (prepared.input.newProducts.length) {
          tsvc.permissions.require('invoice.product');
          if (!raw.newProductsConfirmed) fail('CONFIRM', '新增产品必须逐项核对并明确确认');
        }
        if (prepared.issue && !raw.replacementConfirmed)
          fail('CONFIRM', '重新生成必须确认替换原出库单');
        const result = await tsvc.inventory.with(async (inventory) => {
          if (typeof inventory.saveInvoiceIssue !== 'function')
            fail(
              'CAPABILITY',
              '当前安装版本缺少发票出库保存服务',
              '请安装完整版本后重试，发票不会被标记为已出库',
            );
          return inventory.saveInvoiceIssue({
            input: prepared.input,
            plan: raw.plan,
            newProductsConfirmed: raw.newProductsConfirmed,
            negativeStockConfirmed: raw.negativeStockConfirmed,
            replacementConfirmed: raw.replacementConfirmed,
          });
        });
        let issueId: number;
        if (prepared.issue) {
          issueId = prepared.issue.id;
          await tdb
            .updateTable('invoice_issue')
            .set({
              inventory_document_id: result.id,
              inventory_revision: result.revision,
              number: prepared.input.number,
              date: prepared.input.date,
              input: JSON.stringify(prepared.input),
              revision: prepared.issue.revision + 1,
            })
            .where('id', '=', issueId)
            .execute();
        } else {
          const inserted = await tdb
            .insertInto('invoice_issue')
            .values({
              invoice_id: prepared.invoice.id,
              inventory_document_id: result.id,
              inventory_revision: result.revision,
              number: prepared.input.number,
              date: prepared.input.date,
              input: JSON.stringify(prepared.input),
              created_at: tsvc.ctx.now().toISOString(),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          issueId = inserted.id;
        }
        await tdb
          .updateTable('invoice_document')
          .set({ state: 'issued', revision: prepared.invoice.revision + 1 })
          .where('id', '=', prepared.invoice.id)
          .execute();
        const saved = { ...result, issueId };
        await tdb
          .insertInto('invoice_issue_request')
          .values({
            request_key: raw.options.requestKey,
            payload_hash: payloadHash,
            issue_id: issueId,
            result: JSON.stringify(saved),
          })
          .execute();
        await tsvc.log.write({
          action: prepared.issue ? 'invoice.issue.regenerate' : 'invoice.issue.generate',
          summary: `发票 ${prepared.invoice.number} 转出库单 ${prepared.input.number}`,
          targetType: 'invoice_issue',
          targetId: issueId,
        });
        const key = `issueDraft.${tsvc.user.id}`;
        const draft = await tsvc.settings.get(key, null);
        if (draft != null && digest(draft) === digest(raw.options))
          await tsvc.settings.set(key, null);
        return saved;
      });
    },
    async list() {
      await assertProduct();
      return db.selectFrom('invoice_issue').selectAll().orderBy('id', 'desc').execute();
    },
  };
}
