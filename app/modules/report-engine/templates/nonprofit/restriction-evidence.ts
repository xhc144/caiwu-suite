import { z } from 'zod';

const reference = z.string().trim().min(1, '缺少外部来源或法律依据').max(500);
const condition = z
  .object({ description: reference, releaseReference: reference.optional() })
  .strict();
/** 只验证来源信息和解除条件是否齐备，不替代对真实原始凭据、外部主体和法律效力的核实。
 * nonprofit-2026.pdf 第28–29页第67、69、70条；尚未接入共享限定性持久元数据。 */
export const RestrictionEvidenceSchema = z
  .object({
    authority: z.enum(['assetProvider', 'lawOrRegulation', 'internalDecision']),
    issuer: reference,
    sourceReference: reference,
    resourceReference: reference,
    specificClause: reference,
    time: condition.optional(),
    purpose: condition.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.authority === 'internalDecision')
      ctx.addIssue({ code: 'custom', message: '理事会内部用途决议不是制度所称限定性来源' });
    if (!v.time && !v.purpose)
      ctx.addIssue({ code: 'custom', message: '须提供更具体明确的时间或用途限制' });
  });
export type RestrictionEvidence = z.infer<typeof RestrictionEvidenceSchema>;
export function checkRestrictionTransferEvidence(
  direction: 'release' | 'impose',
  raw: RestrictionEvidence,
): void {
  const evidence = RestrictionEvidenceSchema.parse(raw);
  if (
    direction === 'release' &&
    [evidence.time, evidence.purpose].some((c) => c && !c.releaseReference)
  )
    throw new Error('时间和用途限制必须全部解除；缺少解除依据不能转为非限定性');
  if (
    direction === 'impose' &&
    [evidence.time, evidence.purpose].filter(Boolean).every((c) => !!c?.releaseReference)
  )
    throw new Error('所列限制均已解除，不能据此转为限定性');
}
