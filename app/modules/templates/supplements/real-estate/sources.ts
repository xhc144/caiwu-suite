/** 正式文件的适用边界；网页发布日期与文件签发/施行日期分别记录。 */
export const realEstateSources = {
  chart: {
    title: '企业会计准则——应用指南及附录：会计科目和主要账务处理',
    documentNumber: '财会〔2006〕18号',
    noticeUrl:
      'https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/cwhjjbzdgf/20061201/0017-156907.html',
    url: 'https://czj.sh.gov.cn/resource/f9/f9a90a5ed4b940529d12e91da79edf9a/279ac7de8095a2e08a3f744aac428839.rar',
    issuedOn: '2006-11-06',
    effectiveFrom: '2007-01-01',
    scope:
      '2007年起上市公司施行，鼓励其他企业执行；行业预设只供实际执行企业会计准则的房地产开发企业使用。后续准则增补沿用指定基表。',
    retrieval:
      '通知正文已读取；本次未取得RAR附件字节。基表科目与性质由已授权的只读企业基表继承，不据非官方转载改名。',
  },
  cost: {
    title: '企业产品成本核算制度（试行）',
    documentNumber: '财会〔2013〕17号',
    noticeUrl:
      'https://www.mof.gov.cn/gkml/caizhengwengao/wg2013/wg201309/201403/t20140319_1056828.htm',
    url: 'https://cwfwpt.ggj.gov.cn/zcfg/qykjzd/202306/P020230620583246761887.pdf',
    issuedOn: '2013-08-16',
    effectiveFrom: '2014-01-01',
    scope:
      '除金融保险业以外的大中型企业，鼓励其他企业执行；房地产对象见第十三条，七项成本见第二十六条。',
  },
  revenue: {
    title: '企业会计准则第14号——收入',
    documentNumber: '财会〔2017〕22号',
    url: 'https://m.mof.gov.cn/zcfb/201707/t20170719_2653110.htm',
    scope:
      '依通知分批施行，其他执行企业会计准则的非上市企业自2021年起施行；预收售房价款适用合同负债，不能以收款代替收入确认判断。',
  },
  repeal: {
    title: '财政部关于公布若干废止和失效的会计准则制度类规范性文件目录的通知',
    documentNumber: '财会〔2015〕3号',
    url: 'https://www.mof.gov.cn/gp/xxgkml/hjs/201503/t20150302_2512683.htm',
    issuedOn: '2015-02-16',
    scope:
      '第6项全文废止或失效：财会字〔1993〕2号房地产开发企业会计制度。不能当作2026年新账默认制度。',
  },
} as const;

/** 不注册一个无法由官方全文核实的历史科目表。 */
export const historicalRealEstateAvailability = {
  originalTemplate: 'a14.acd',
  kind: 'blocked',
  documentNumber: '财会字〔1993〕2号',
  effectiveFrom: '1993-07-01',
  repealedBy: '财会〔2015〕3号',
  repealDocumentDate: '2015-02-16',
  reason:
    '尚未取得含完整科目表及使用说明的官方原文，不能以第三方摘要、记忆或新准则基表冒充旧制度。',
} as const;
