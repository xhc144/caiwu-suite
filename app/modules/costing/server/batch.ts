import { formatVoucherNo, periodOfDate } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { z } from 'zod';
import {
  BatchVoucherSchema,
  ExecuteBatchVoucherSchema,
  type BatchNumberingStep,
} from '../fx-batch-shared';
import { digest } from './inventory-read';
import { fail } from './math';
import { requireCostingOwner } from './owner';
import {
  advanceBatchState,
  assertBatchDeletion,
  assertBatchState,
  expectedBatchLinks,
  initialBatchState,
  planBatchNumbering,
} from './batch-numbering';
import {
  generateVoucher,
  listVoucherDocuments,
  previewVoucher,
  previewVoucherDelete,
  regenerateVoucher,
} from './vouchers';

type BatchInput = z.infer<typeof BatchVoucherSchema>;
type Preview = Awaited<ReturnType<typeof previewVoucher>>;
type Deletion = Awaited<ReturnType<typeof previewVoucherDelete>>;
type BatchRow = {
  key: string;
  documentId?: number;
  countId?: number;
  date: string;
  number: string;
  action: 'generate' | 'regenerate' | 'skip' | 'failed';
  message: string;
  preview: Preview | null;
  deletion: Deletion | null;
  numbering: BatchNumberingStep | null;
};

function semantics(preview: Preview) {
  return digest({
    date: preview.date,
    lines: preview.lines,
    expectedRevision: preview.expectedRevision,
    links: preview.links,
    batchId: preview.batchId,
    generationBlocker: preview.generationBlocker,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '处理失败，请重新预览并核对来源单据';
}

async function buildBatch(svc: CoreServices, input: BatchInput) {
  const policy = await svc.voucherPolicy.get();
  if (policy.numbering === 'manual' && input.startNumber == null)
    fail('NUMBER', '当前账套采用手工编号，请输入批量起始编号');
  const snapshot = await svc.inventory.snapshot(periodOfDate(input.to));
  const warehouseOfDocument = new Map(snapshot.documents.map((d) => [d.id, d.warehouseId]));
  const warehouseOfCount = new Map(snapshot.counts.map((c) => [c.id, c.warehouseId]));
  const sources = (await listVoucherDocuments(svc))
    .filter(
      (d) =>
        d.date >= input.from &&
        d.date <= input.to &&
        (input.purpose === 'count'
          ? d.kind === 'count'
          : input.purpose === 'receipt'
            ? d.kind === 'receipt'
            : d.kind === 'issue' && (input.purpose !== 'revenue' || d.category === '销售')) &&
        (!input.warehouseId ||
          (d.kind === 'count' ? warehouseOfCount.get(d.id) : warehouseOfDocument.get(d.id)) ===
            input.warehouseId),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  if (sources.length > 500) fail('BATCH_SIZE', '一次最多处理五百张来源单据，请缩小日期范围');
  const rows: BatchRow[] = [];
  for (const document of sources) {
    const target = {
      documentId: document.documentId,
      countId: document.countId,
      purpose: input.purpose,
      taxAccountId: input.taxAccountId,
      revenueAccountId: input.revenueAccountId,
      adjustmentAccountId: input.adjustmentAccountId,
    };
    const row: BatchRow = {
      key: `${document.kind}:${document.id}`,
      documentId: document.documentId,
      countId: document.countId,
      date: document.date,
      number: document.number,
      action: 'generate',
      message: '按来源日期生成凭证',
      preview: null,
      deletion: null,
      numbering: null,
    };
    const link = document.sources.find((s) => s.purpose === input.purpose);
    if (input.purpose === 'receipt' && document.productionOwned) {
      row.action = 'skip';
      row.message = '完工入库凭证由生产成本分摊功能管理';
    } else if (input.purpose === 'revenue' && document.sourceType === 'invoice') {
      row.action = 'skip';
      row.message = '来自销售发票，收入凭证由发票功能管理，避免重复制证';
    } else if (link?.status === 'audited' || link?.status === 'posted') {
      row.action = 'skip';
      row.message = '已有凭证已审核或过账，保留原凭证';
    } else if (link && !input.regenerate) {
      row.action = 'skip';
      row.message = '已经生成本用途凭证';
    } else {
      try {
        row.preview = await previewVoucher(svc, target);
        await svc.periods.assertWritable({
          period: periodOfDate(row.preview.date),
          action: '批量生成来源凭证',
        });
        if (row.preview.generationBlocker) {
          row.action = 'skip';
          row.message = row.preview.generationBlocker;
        } else if (link) {
          row.action = 'regenerate';
          row.message = '删除原凭证后重新生成，失败保留原凭证';
          row.deletion = await previewVoucherDelete(svc, target);
        }
      } catch (error) {
        row.action = 'failed';
        row.message = errorMessage(error);
      }
    }
    rows.push(row);
  }
  const numbering = await planBatchNumbering(svc, rows, input, policy);
  for (const row of rows) row.numbering = numbering.steps.get(row.key) ?? null;
  return {
    rows,
    policy,
    numbering,
    fingerprint: digest({
      bookId: snapshot.bookId,
      actorId: svc.user.id,
      moduleId: svc.moduleId,
      input,
      policy,
      vouchers: numbering.initial,
      rows: rows.map((r) => ({
        ...r,
        preview: r.preview ? semantics(r.preview) : null,
        deletion: r.deletion?.plan.impacts ?? null,
      })),
    }),
  };
}

export async function previewVoucherBatch(
  svc: CoreServices,
  raw: z.input<typeof BatchVoucherSchema>,
) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.voucher');
  const input = BatchVoucherSchema.parse(raw);
  return svc.tx(async (t) => {
    const { numbering: _numbering, ...preview } = await buildBatch(t, input);
    return preview;
  });
}

/** 每张来源单据独立事务；错误和跳过逐条返回，成功项才消耗手工编号。 */
export async function executeVoucherBatch(
  svc: CoreServices,
  raw: z.input<typeof ExecuteBatchVoucherSchema>,
) {
  requireCostingOwner(svc);
  svc.permissions.require('costing.voucher');
  const input = ExecuteBatchVoucherSchema.parse(raw);
  if (!input.confirmed) fail('CONFIRM', '批量制证需要先核对预览并确认');
  const filter = BatchVoucherSchema.parse(input);
  const plan = await svc.tx((t) => buildBatch(t, filter));
  if (plan.fingerprint !== input.fingerprint)
    fail('STALE', '批量来源或编号影响已变化，请重新预览后确认');
  const results: {
    key: string;
    number: string;
    date: string;
    status: 'generated' | 'regenerated' | 'skipped' | 'failed';
    message: string;
    voucherId?: number;
    displayNo?: string;
  }[] = [];
  let nextNumber = input.startNumber;
  let expected = initialBatchState(plan.numbering.initial);
  for (const row of plan.rows) {
    if (row.action === 'skip' || row.action === 'failed') {
      results.push({
        key: row.key,
        number: row.number,
        date: row.date,
        status: row.action === 'skip' ? 'skipped' : 'failed',
        message: row.message,
      });
      continue;
    }
    try {
      const saved = await svc.tx(async (t) => {
        if (digest(await t.voucherPolicy.get()) !== digest(plan.policy))
          fail('STALE', '凭证编号策略已经变化，请重新预览');
        if (row.numbering) await assertBatchState(t, plan.numbering, expected);
        const target = {
          documentId: row.documentId,
          countId: row.countId,
          purpose: input.purpose,
          taxAccountId: input.taxAccountId,
          revenueAccountId: input.revenueAccountId,
          adjustmentAccountId: input.adjustmentAccountId,
        };
        const current = await previewVoucher(t, target);
        const approved = row.preview && {
          ...row.preview,
          links: expectedBatchLinks(row.preview.links, expected),
        };
        if (!approved || semantics(current) !== semantics(approved))
          fail('STALE', '本张来源或凭证已变化，请重新预览');
        const generation = {
          ...target,
          voucherTypeId: input.voucherTypeId,
          ...(plan.policy.numbering === 'manual' ? { number: nextNumber } : {}),
          expectedRevision: current.expectedRevision,
          fingerprint: current.fingerprint,
          confirmed: true,
        };
        const deletion = row.action === 'regenerate' ? await previewVoucherDelete(t, target) : null;
        if (deletion) {
          if (row.numbering) assertBatchDeletion(expected, row.numbering, deletion.plan);
          else if (digest(deletion.plan.impacts) !== digest(row.deletion?.plan.impacts))
            fail('STALE', '删除后的编号影响已经变化，请重新预览本单后重试');
        }
        if (
          row.numbering &&
          plan.policy.numbering === 'manual' &&
          nextNumber !== row.numbering.created.number
        )
          fail('STALE', '前项失败后编号与已确认的逐步映射不一致，请重新预览后确认');
        const voucher = deletion
          ? await regenerateVoucher(t, {
              ...generation,
              voucherDeletion: { plan: deletion.plan, confirmed: true },
            })
          : await generateVoucher(t, generation);
        let nextExpected = expected;
        if (row.numbering) {
          if (
            voucher.number !== row.numbering.created.number ||
            voucher.period !== row.numbering.created.period
          )
            fail('STALE', '新凭证编号与已确认的逐步映射不一致，请重新预览后确认');
          nextExpected = await advanceBatchState(
            t,
            expected,
            deletion?.plan ?? null,
            row.numbering,
            voucher,
          );
          await assertBatchState(t, plan.numbering, nextExpected);
        }
        return { voucher, nextExpected };
      });
      const { voucher } = saved;
      expected = saved.nextExpected;
      results.push({
        key: row.key,
        number: row.number,
        date: row.date,
        status: row.action === 'regenerate' ? 'regenerated' : 'generated',
        message: '凭证已保存',
        voucherId: voucher.id,
        displayNo: voucher.displayNo,
      });
      if (plan.policy.numbering === 'manual' && nextNumber != null) nextNumber += 1;
    } catch (error) {
      results.push({
        key: row.key,
        number: row.number,
        date: row.date,
        status: 'failed',
        message: errorMessage(error),
      });
    }
  }
  // 后续步骤可能重排本批先前保存的凭证，结果应显示最后一次成功事务后的字号。
  for (const result of results) {
    const state = expected.find((v) => v.key === `new:${result.key}`);
    if (result.voucherId != null && state)
      result.displayNo = formatVoucherNo(state.typeCode, state.number);
  }
  return {
    results,
    succeeded: results.filter((r) => r.status === 'generated' || r.status === 'regenerated').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}
