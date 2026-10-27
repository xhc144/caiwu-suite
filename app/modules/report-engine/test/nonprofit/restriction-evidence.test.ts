import { describe, expect, it } from 'vitest';
import { checkRestrictionTransferEvidence } from '../../templates/nonprofit/restriction-evidence';
import { releaseEvidence, imposeEvidence } from './evidence-fixture';

describe('限定性来源与解除条件的拒绝检查（尚非持久分类系统）', () => {
  it('虚构外部提供者撤销来源和补充约定齐备，仅通过信息完整性检查', () => {
    expect(() => checkRestrictionTransferEvidence('release', releaseEvidence)).not.toThrow();
    expect(() => checkRestrictionTransferEvidence('impose', imposeEvidence)).not.toThrow();
  });
  it('内部用途决议、缺外部来源和未具体设置限制均拒绝', () => {
    expect(() =>
      checkRestrictionTransferEvidence('impose', {
        ...imposeEvidence,
        authority: 'internalDecision',
        issuer: '本组织理事会',
      }),
    ).toThrow(/内部用途决议/);
    expect(() =>
      checkRestrictionTransferEvidence('impose', { ...imposeEvidence, sourceReference: '' }),
    ).toThrow(/来源/);
    expect(() =>
      checkRestrictionTransferEvidence('impose', { ...imposeEvidence, purpose: undefined }),
    ).toThrow(/具体/);
  });
  it('时间与用途同时受限时，只满足其一不准解除；不能将已解除条件作为新限定依据', () => {
    expect(() =>
      checkRestrictionTransferEvidence('release', {
        ...releaseEvidence,
        time: { description: '2026-12-31之前专用' },
      }),
    ).toThrow(/全部解除/);
    expect(() =>
      checkRestrictionTransferEvidence('release', {
        ...releaseEvidence,
        purpose: { description: '食品专用' },
        time: { description: '时间已到期', releaseReference: '到期记录' },
      }),
    ).toThrow(/全部解除/);
    expect(() => checkRestrictionTransferEvidence('impose', releaseEvidence)).toThrow(/均已解除/);
  });
});
