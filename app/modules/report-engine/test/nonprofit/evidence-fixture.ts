import type { RestrictionEvidence } from '../../templates/nonprofit/restriction-evidence';

/** 全部虚构，仅供信息完整性拒绝测试；不是对真实法定限定资格的认定。 */
export const releaseEvidence: RestrictionEvidence = {
  authority: 'assetProvider',
  issuer: '虚构外部捐赠者甲',
  sourceReference: '捐赠协议R1及捐赠者甲2026-02-03撤销限制函R1-C',
  resourceReference: 'R1捐赠中单独识别的6000分余额批次',
  specificClause: '原限定用于救助食品；提供者对本6000分批次撤销全部用途限制；无时间限制',
  purpose: { description: '救助食品专用', releaseReference: '外部提供者甲撤销函R1-C' },
};
export const imposeEvidence: RestrictionEvidence = {
  authority: 'assetProvider',
  issuer: '虚构外部捐赠者乙',
  sourceReference: '原非限定捐赠协议U1的双方书面补充协议U1-A（2026-02-04）',
  resourceReference: 'U1捐赠中单独识别的2000分余额批次',
  specificClause:
    '外部提供者乙在补充协议中将本批次使用范围限定为受助学生学费；不是组织内部指定用途',
  purpose: { description: '指定受助学生学费专用' },
};
