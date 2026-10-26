import { z } from 'zod';
import { parseTemplate, type AccountingTemplate } from '@caiwu/core';

const locator = z.string().trim().min(1, '请填写原文页码或条款');
const officialUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.gov.cn') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}, '来源须为公开的政府网站 HTTPS 地址');

/** 只核对结构及来源声明的一致性，不能证明原稿权威性、转录正确或采集许可。 */
export const EnterpriseChartEvidenceSchema = z
  .object({
    templateId: z.string().min(1),
    templateVersion: z.string().min(1),
    edition: z.string().min(1),
    publicationId: z.string().min(1),
    legalStatus: z.enum(['published', 'historical', 'draft']),
    documentUrl: officialUrl,
    documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    tableAccountCount: z.number().int().positive(),
    rows: z
      .array(
        z
          .object({
            ordinal: z.number().int().positive(),
            code: z.string().regex(/^\d{4}$/),
            name: z.string().min(1),
            category: z.enum(['asset', 'liability', 'common', 'equity', 'cost', 'pnl']),
            tableLocator: locator,
            scope: z.enum(['general', 'industry', 'unconfirmed']),
            scopeNote: locator,
            direction: z.enum(['debit', 'credit', 'both', 'no-closing-balance', 'unconfirmed']),
            directionLocator: locator.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.rows.length !== value.tableAccountCount)
      ctx.addIssue({ code: 'custom', message: '来源表行数与声明的完整行数不一致' });
    const codes = new Set<string>();
    for (const [index, row] of value.rows.entries()) {
      if (row.ordinal !== index + 1)
        ctx.addIssue({ code: 'custom', message: `来源表序号 ${row.ordinal} 缺漏或顺序不对` });
      if (codes.has(row.code))
        ctx.addIssue({ code: 'custom', message: `来源表科目 ${row.code} 重复` });
      codes.add(row.code);
      if (row.direction !== 'unconfirmed' && !row.directionLocator)
        ctx.addIssue({ code: 'custom', message: `科目 ${row.code} 缺方向证据定位` });
    }
  });

/** 供完整表到位后使用；不修改传入模板，也不写入或补改已有账套。 */
export function parseSourcedEnterpriseTemplate(raw: unknown, rawEvidence: unknown) {
  const template = parseTemplate(raw);
  const evidence = EnterpriseChartEvidenceSchema.parse(rawEvidence);
  const problems: string[] = [];
  if (template.regime !== 'enterprise') problems.push('必须是企业会计准则模板');
  if (template.id !== evidence.templateId || template.version !== evidence.templateVersion)
    problems.push('模板身份/版本与来源版本不一致');
  if (evidence.legalStatus === 'draft') problems.push('征求意见稿不能登记为已发布的初始模板');
  if (template.accounts.length !== evidence.tableAccountCount)
    problems.push('模板未覆盖完整来源表');
  if (
    !template.sources.some(
      (source) =>
        source.file === evidence.documentUrl &&
        [evidence.edition, evidence.publicationId, evidence.documentSha256].every((reference) =>
          source.note?.includes(reference),
        ),
    )
  )
    problems.push('模板sources必须绑定同一官方原文、版本及摘要');
  const sourceRows = new Map(evidence.rows.map((row) => [row.code, row]));
  for (const account of template.accounts) {
    const row = sourceRows.get(account.code);
    if (!row || row.name !== account.name || row.category !== account.category) {
      problems.push(`科目 ${account.code} 编码、名称或类别与来源不一致`);
      continue;
    }
    if (!account.direction)
      problems.push(`科目 ${account.code} 必须明确显示方向，不能沿用类别猜测`);
    if (
      (row.direction === 'debit' || row.direction === 'credit') &&
      account.direction !== row.direction
    )
      problems.push(`科目 ${account.code} 的方向与证据不一致`);
    if (
      (['both', 'no-closing-balance', 'unconfirmed'].includes(row.direction) ||
        row.scope === 'unconfirmed') &&
      !account.needsReview
    )
      problems.push(
        `科目 ${account.code} 的未确认或未获core支持的性质必须 needsReview；借/贷值不能代表完整业务语义`,
      );
    for (const reference of [
      evidence.publicationId,
      evidence.edition,
      row.tableLocator,
      row.scopeNote,
      `适用:${row.scope}`,
      row.directionLocator,
    ]) {
      if (reference && !account.source?.includes(reference))
        problems.push(`科目 ${account.code} 的 source 缺少原文/方向/适用范围定位`);
    }
    if (
      ['both', 'no-closing-balance', 'unconfirmed'].includes(row.direction) &&
      !account.source?.includes(`性质:${row.direction}`)
    )
      problems.push(`科目 ${account.code} 必须标明双向、无期末余额或方向待核性质`);
  }
  if (problems.length) throw new Error(`企业科目来源校验失败：${problems.join('；')}`);
  return { template, evidence };
}

export function templateReviewWarning(template: AccountingTemplate | undefined) {
  if (!template) return null;
  const pending = template.accounts.filter((account) => account.needsReview).length;
  if (!pending) return null;
  return `所选模板有${pending}项待核科目（共${template.accounts.length}项）。${template.description ?? '请核对原文及适用范围。'}仅在本次新建时生成科目，不补改已有账套。`;
}
