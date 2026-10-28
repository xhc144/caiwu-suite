/** 只记录财政、监管原文；网页发布日期与制度施行日期分别记录。 */
export const constructionSources = {
  revenue2017: {
    title: '关于修订印发《企业会计准则第14号——收入》的通知（财会〔2017〕22号）',
    file: 'https://fgk.mof.gov.cn/ui/src/views/law_html/84629.html',
    note: '通知第一项：2018/2020/2021分批施行；执行后不再执行原收入及建造合同准则。准则第二十六至三十条、第四十一条。仓库原文rules/sources/official/revenue-2017.pdf及revenue-2017-notice.html。',
  },
  enterprise2019: {
    title: '2019年度一般企业财务报表格式（财会〔2019〕6号）附件2',
    file: 'https://kjs.mof.gov.cn/zhengcefabu/201905/P020190510359607790104.pdf',
    note: 'PDF第8页第22项明确允许合同结算，并规定价款结算、收入结转明细及借贷两向列报；第9页第24项为合同履约成本及其减值准备。仓库原文enterprise-2019-appendix2.pdf。不据本附件生成2026报表。',
  },
  small2011: {
    title: '小企业会计准则（财会〔2011〕17号）及附录',
    file: 'rules/sources/official/small-appendix.pdf',
    note: '2013-01-01起，范围及排除条件见准则第二、三条；附录PDF第20—21页1411，第57—58页4401/4403。仓库原文small-standard.pdf、small-appendix.pdf。',
  },
  construction2003: {
    title: '施工企业会计核算办法（财会〔2003〕27号）',
    file: 'https://czj.changzhou.gov.cn/content/suitable/show?catid=1224&id=7835',
    note: '2003-09-25印发，2004-01-01起在已执行《企业会计制度》的施工企业施行。第二部分（一）1—3及（二）1233/1281/1506/1507/1702/2123/4104/4110、主营业务收入/主营业务成本说明。常州转载有“推销”等排字错误；成本标题编码印作5102，5401父级定位待完整2001基表原文核定，历史包因此不注册。',
  },
  repeal1993: {
    title: '关于公布若干废止和失效的会计准则制度类规范性文件目录的通知（财会〔2015〕3号）',
    file: 'https://www.mof.gov.cn/gkml/caizhengwengao/wg2015/wg201504/201509/t20150916_1458699.htm',
    note: '2015-02-16通知第5项明文列出财会字〔1992〕70号《施工企业会计制度》。不能将1993制度作为当前默认。',
  },
  transition1993: {
    title: '关于全民所有制施工企业新旧会计制度衔接帐务处理办法',
    file: 'https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=12591',
    note: '仅核对1993-07-01新旧制度切换；商务部法规库标注原文信息来自北大法宝，不作为本补充科目编号依据。',
  },
} as const;
