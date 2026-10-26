import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { ReportTemplateSchema, type ReportTemplate } from '../../shared';
import {
  ActivityTotalsMappingSchema,
  activity402TotalsTemplate,
  checkActivityTotalsSources,
  incomeIds,
  expenseIds,
} from './activity-totals';
import { activityRows, textCell } from './forms';
import { activityMovement } from './period-formulas';
import { RestrictionEvidenceSchema } from './restriction-evidence';

const reference = z.string().trim().min(1, '分类须有外部来源核对依据').max(500);
const account = z.string().regex(/^\d{1,20}$/);
const unrestrictedLeaf = z
  .object({
    account,
    /** 明确声明该实际末级仅核算这一资源依据与确认分类；不支持同末级混合分类。 */
    exclusiveResource: z.literal(true),
    evidence: z
      .object({
        authority: z.enum(['assetProvider', 'lawOrRegulation']),
        issuer: reference,
        sourceReference: reference,
        resourceReference: reference,
        specificClause: reference,
        conclusion: z.literal('noExternalRestriction'),
      })
      .strict(),
  })
  .strict();
const restrictedLeaf = z
  .object({
    account,
    exclusiveResource: z.literal(true),
    evidence: RestrictionEvidenceSchema,
    // 收入记录资源批次的取得；费用记录该受限资源实际使用的单据关联。
    recognitionReference: reference,
  })
  .strict();
const ids = [...incomeIds, ...expenseIds] as const;

/** 外部依据逐末级绑定；普通项目、摘要、科目名称或内部用途决议均不能替代分类依据。
 * nonprofit-2026.pdf 第28–29、33–36、130–131、142–146页。
 * 本结构由公共profile持久绑定；说明行不能替代受保护的分类元数据。 */
export const ActivityClassifiedMappingSchema = z
  .object({
    totals: ActivityTotalsMappingSchema,
    groups: z.record(
      z.enum(ids),
      z
        .object({
          unrestricted: z.array(unrestrictedLeaf).max(4),
          restricted: z.array(restrictedLeaf).max(4),
        })
        .strict(),
    ),
    /** 可逐笔复核的确认清单；提供时必须完整，不能只列部分有利分录。 */
    recognitions: z
      .array(
        z
          .object({
            voucherId: z.number().int().positive(),
            lineId: z.number().int().positive(),
            revision: z.number().int().positive(),
            period: z.number().int(),
            account: account,
            debit: z.number().int().safe(),
            credit: z.number().int().safe(),
            classification: z.enum(['unrestricted', 'restricted']),
            resourceReference: reference,
            sourceReference: reference,
          })
          .strict(),
      )
      .max(200000)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen: string[] = [];
    for (const id of ids) {
      const group = v.groups[id];
      for (const leaf of [...group.unrestricted, ...group.restricted]) {
        if (seen.some((old) => old.startsWith(leaf.account) || leaf.account.startsWith(old)))
          ctx.addIssue({ code: 'custom', message: `分类科目重复或父子重叠：${leaf.account}` });
        seen.push(leaf.account);
        if (!v.totals.groups[id].accounts.some((code) => leaf.account.startsWith(code)))
          ctx.addIssue({ code: 'custom', message: `分类科目不在本项目合计范围：${leaf.account}` });
      }
      // 此处按取得/实际使用的确认依据分类。后续解除是净资产互转事件，
      // 不因releaseReference存在而追溯改写原收入费用的限定性。
    }
  });
export type ActivityClassifiedMapping = z.infer<typeof ActivityClassifiedMappingSchema>;

/** 只补8项收入、7项费用的4列及两类小计；互转/调整/最终净变动没有可靠事件时保留待接入。 */
export function activity402ClassifiedTemplate(raw: ActivityClassifiedMapping): ReportTemplate {
  const mapping = ActivityClassifiedMappingSchema.parse(raw);
  const t = activity402TotalsTemplate(mapping.totals);
  t.name = '民非业务活动表（收入费用分类取数切片，净资产事件未接入）';
  t.cells.find((c) => c.address === 'A1')!.source =
    '业务活动表（收入费用分类取数切片，净资产互转及调整未接入）';
  t.cells.find((c) => c.address === 'A3')!.source =
    `依据期间${mapping.totals.period}；仅已过账；排除损益结转、保留退款及自定义转账；分类由公共事务复核，仍非完整法定报表`;
  const row = (id: string) => activityRows.findIndex((r) => r.id === id) + 5;
  const replace = (address: string, source: string) => {
    t.cells = t.cells.filter((c) => c.address !== address);
    t.cells.push({ address, source, kind: 'formula', unit: 'cents', currency: 'CNY' });
  };
  for (const [unrestricted, restricted, total, range] of [
    ['B', 'C', 'D', 'month'],
    ['E', 'F', 'G', 'ytd'],
  ] as const) {
    for (const id of ids) {
      for (const [col, kind] of [
        [unrestricted, 'unrestricted'],
        [restricted, 'restricted'],
      ] as const) {
        const leaves = mapping.groups[id][kind];
        // 空集合的0仅表示明确未分配该类末级科目；实际发生额覆盖必须经预检。
        const sum = leaves.length
          ? `SUM(${leaves.map((leaf) => activityMovement(leaf.account, range)).join(',')})`
          : '0';
        replace(
          `${col}${row(id)}`,
          (expenseIds as readonly string[]).includes(id) ? `-(${sum})` : sum,
        );
      }
      t.checks.push({
        name: `${range === 'month' ? '本月' : '累计'}${activityRows[row(id) - 5]!.label}分类等于合计`,
        left: `${unrestricted}${row(id)}+${restricted}${row(id)}`,
        right: `${total}${row(id)}`,
        tolerance: '0',
      });
    }
    for (const [subtotal, details] of [
      ['incomeTotal', incomeIds],
      ['expenseTotal', expenseIds],
    ] as const) {
      for (const col of [unrestricted, restricted])
        replace(
          `${col}${row(subtotal)}`,
          `SUM(${details.map((id) => `${col}${row(id)}`).join(',')})`,
        );
      t.checks.push({
        name: `${range === 'month' ? '本月' : '累计'}${activityRows[row(subtotal) - 5]!.label}分类等于合计`,
        left: `${unrestricted}${row(subtotal)}+${restricted}${row(subtotal)}`,
        right: `${total}${row(subtotal)}`,
        tolerance: '0',
      });
    }
  }
  const note = (source: string) => {
    const n = ++t.rows;
    t.cells.push(textCell(`A${n}`, source));
    t.merges.push({ row: n, col: 1, rows: 1, cols: t.cols });
  };
  for (const id of ids)
    for (const kind of ['unrestricted', 'restricted'] as const)
      for (const leaf of mapping.groups[id][kind]) {
        const e = leaf.evidence;
        // 分行保留所有输入依据，避免长来源截断或突破单元格内容预算。
        note(
          `${activityRows[row(id) - 5]!.label} ${kind === 'unrestricted' ? '非限定性' : '限定性'}实际末级${leaf.account}；外部主体${e.issuer}；来源类型${e.authority === 'assetProvider' ? '资产提供者' : '国家有关法律、行政法规'}`,
        );
        note(`来源${e.sourceReference}；资源${e.resourceReference}`);
        note(`具体条款${e.specificClause}`);
        if ('recognitionReference' in leaf) {
          note(`取得/实际使用关联${leaf.recognitionReference}`);
          for (const condition of [leaf.evidence.time, leaf.evidence.purpose])
            if (condition)
              note(
                `限制${condition.description}；解除依据${condition.releaseReference ?? '未解除'}`,
              );
        } else note('已核对外部依据未设置制度所称时间或用途限制；不按普通project推断');
      }
  note(
    '后续事件来源：双向互转须逐笔关联非限定/限定净资产分录（制度3101/3102）、发生时点、资源批次及外部设限/全部解除凭据；以前年度调整须关联以前年度净资产调整分录（制度3201）、原期间及调整依据，科目均须按实际账套显式映射；净变动须待上述完整事件及净资产勾稽接通，不能以0补齐。',
  );
  t.reportIdentity = 'nonprofit-activity402-classified';
  t.profile = {
    mode: 'declaration',
    version: 1,
    kind: t.reportIdentity,
    scope: 'posted',
    period: mapping.totals.period,
    mapping,
  };
  return ReportTemplateSchema.parse(t);
}

/** 供公共profile注册点在generate同事务调用的预检；单独调用不授予跨请求凭据。 */
export async function checkActivityClassifiedSources(
  svc: CoreServices,
  period: number,
  raw: ActivityClassifiedMapping,
  generation = { includeUnposted: false },
): Promise<void> {
  const mapping = ActivityClassifiedMappingSchema.parse(raw);
  await checkActivityTotalsSources(svc, period, mapping.totals, generation);
  const start = Math.floor(period / 100) * 100 + 1;
  for (let month = start; month <= period; month++) await svc.periods.require(month);
  const categories = new Map((await svc.accounts.categories()).map((c) => [c.id, c]));
  const classified = new Set<string>();
  for (const id of ids)
    for (const leaf of [...mapping.groups[id].unrestricted, ...mapping.groups[id].restricted]) {
      const a = await svc.accounts.require(leaf.account);
      if (!a.isLeaf) throw new Error(`分类须绑定实际末级科目：${leaf.account}`);
      const category = categories.get(a.categoryId)!;
      const direction = (incomeIds as readonly string[]).includes(id) ? 'credit' : 'debit';
      if (!category.isPnl || category.direction !== direction)
        throw new Error(`分类科目收入费用类别与报表项目不匹配：${leaf.account}`);
      classified.add(a.code);
    }
  const accounts = new Map((await svc.accounts.list()).map((a) => [a.id, a]));
  const rows = await svc.ledger.balances({
    periodFrom: start,
    periodTo: period,
    rollup: false,
    excludeClosingKinds: ['pnl'],
  });
  for (const r of rows) {
    const a = accounts.get(r.accountId)!;
    // 检查借贷两边，净额为0仍有实际发生，不能静默漏掉。
    if (
      categories.get(a.categoryId)?.isPnl &&
      (r.debit !== 0 || r.credit !== 0 || r.ytdDebit !== 0 || r.ytdCredit !== 0) &&
      !classified.has(r.accountCode)
    )
      throw new Error(`尚有未分类的实际收入费用发生额：${r.accountCode}`);
  }
}
