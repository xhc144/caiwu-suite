import { z } from 'zod';

const reference = z.string().trim().min(1, '缺少外部来源或法律依据').max(500);
const condition = z
  .object({ description: reference, releaseReference: reference.optional() })
  .strict();
/** 只验证来源信息和解除条件是否齐备，不替代对真实原始凭据、外部主体和法律效力的核实。
 * nonprofit-2026.pdf 第28–29页第67、69、70条。 */
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

/** 解除须覆盖资源原有及后续外部设限，不能以一个较弱的新声明替换旧条款。 */
export function assertOriginalRestrictionsReleased(
  original: RestrictionEvidence[],
  released: RestrictionEvidence[],
) {
  const key = (r: RestrictionEvidence) =>
    JSON.stringify([
      r.authority,
      r.issuer,
      r.sourceReference,
      r.resourceReference,
      r.specificClause,
      r.time?.description ?? null,
      r.purpose?.description ?? null,
    ]);
  if (!original.length) throw new Error('解除事件缺少原始外部限制依据');
  for (const rule of original) {
    const evidence = released.find((r) => key(r) === key(rule));
    if (!evidence) throw new Error('解除依据未完整覆盖原时间、用途限制及其外部来源');
    checkRestrictionTransferEvidence('release', evidence);
  }
  if (released.some((r) => !original.some((x) => key(x) === key(r))))
    throw new Error('解除事项的限制条款与原始资源不一致');
}
