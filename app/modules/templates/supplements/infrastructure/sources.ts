/** Only original legal text and regulator publications; no installer or live-book data. */
export const infrastructureSources = {
  construction1995: {
    title: '国有建设单位会计制度（财会字〔1995〕45号）',
    file: 'https://zwfw.mof.gov.cn/webfile/fwzx/2020-06-12/372.html',
    note: '财政部政务服务平台原文；总说明1、3，二（一）46项总账及二（二）各科目说明。1996年起施行；本包1996版本限定1996—1997历史核算。明细编号由软件分配，原文只规定名称。',
  },
  effective1996: {
    title: '财政部公告2020年第7号所附现行有效规章目录',
    file: 'https://zwfw.mof.gov.cn/webfile/fwzx/2020-03-09/345.html',
    note: '目录第9项：1995-10-04公布，1996-01-01施行；目录不表示所有单位2026年仍适用旧建设单位核算。',
  },
  construction1998: {
    title: '财会字〔1998〕17号附件1《国有建设单位会计制度补充规定》',
    file: 'https://policy.mofcom.gov.cn/claw/clawContent.shtml?id=5025',
    note: '商务部政府网站刊载〔1998〕外经贸计财字第445号转发通知及财政部完整附件原文；页面标注信息来源北大法宝，非财政部原始附件影印。只使用附件1一（一）至（七）正文，不采用网站时效标签或第三方解释。1998-01-01起；新增总账原文未编号，本包105/106/308为软件分配。',
  },
  enterprise2006: {
    title: '关于印发《企业会计准则－应用指南》的通知（财会〔2006〕18号）',
    file: 'https://czj.sh.gov.cn/zys_8908/zcfg_8983/zcfb_8985/hj_9035/cwhjjbzdgf/20061201/0017-156907.html',
    note: '上海市财政局刊载财政部通知；2007-01-01起上市公司施行、鼓励其他企业执行。企业基表由调用方提供，本包不重新生成或扩大基表适用范围。',
  },
  enterpriseDetails: {
    title: '国家机关事务管理局系统级企业会计科目体系及使用说明',
    file: 'https://cwfwpt.ggj.gov.cn/tzgg/202207/P020220708298486466505.pdf',
    note: '官方原文PDF物理第4页第33项及第23页1604说明：建筑工程、安装工程、在安装设备、待摊支出，项目辅助。其强制系统编号规则只适用于国管局系统企业；本包将同名分类作为企业自建明细的应用预设，不宣称全国企业必须使用该系统编码。',
  },
  government2018: {
    title: '财政部关于贯彻实施政府会计准则制度的通知（财会〔2018〕21号）',
    file: 'https://www.mof.gov.cn/gkml/caizhengwengao/wg2018/wg09/201901/t20190102_3112192.htm',
    note: '一（二）、二（二）：2019年起行政事业单位全面施行政府会计准则制度，不再执行旧国有建设单位制度，基本建设业务纳入单位大账。',
  },
  government2017: {
    title: '财政部会计司有关负责人就印发政府会计制度答记者问',
    file: 'https://kjs.mof.gov.cn/zhengcejiedu/201711/t20171109_2746905.htm',
    note: '财务会计与预算会计适度分离并相互衔接、基本建设不再单独建账。仅用于适用范围与双体系要求，不据答记者问补造科目。',
  },
  governmentChart: {
    title: '政府会计制度——行政事业单位会计科目和报表（财会〔2017〕25号）',
    file: 'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web2651/site/attach/0/c62d22fa7170425faf9398ea2c67243d.pdf',
    note: '浙江政务公开政府网站附件，完整财政部通知及制度原文。PDF物理第8—13页一级表，第47—53页1611/1613，第120页6001、第129—131页7101/7201、第140—141页8001。2019-01-01起；本包仅独立核对基建相关子集，未穷尽后续解释或年度收支分类。',
  },
} as const;

export const originalInfrastructureEntries = [
  { file: 'a12.acd', order: 11, name: '基建企业会计准则', implementation: 'enterprise-preset' },
  {
    file: 'a15.acd',
    order: 15,
    name: '国有建设单位会计准则',
    implementation: 'historical-template',
  },
] as const;
