/** 原aclist.txt的44项逐项映射；“现行替代”和“地区参考”不等于恢复原档案。 */
export type LegacyTemplateEntry = {
  file: string;
  order: number;
  name: string;
  coverage:
    | 'current'
    | 'current-replacement'
    | 'regional-only'
    | 'reference-only'
    | 'dual-system-required'
    | 'source-required'
    | 'historical-missing';
  templateIds: readonly string[];
  remaining: string;
};

const rows: readonly [
  string,
  string,
  LegacyTemplateEntry['coverage'],
  readonly string[],
  string,
][] = [
  [
    'a01',
    '企业会计准则（科目级数4-3-3）',
    'current',
    ['books-enterprise-cas-2006'],
    '由企业基表及级次参数提供；非旧原档案逐字恢复',
  ],
  [
    'a02',
    '企业会计准则（科目级数4-2-2）',
    'current',
    ['books-enterprise-cas-2006'],
    '同制度按级次建账',
  ],
  [
    'a05',
    '小企业会计准则（科目级数4-3-3）',
    'current',
    ['books-small-business'],
    '由小企业基表及级次参数提供',
  ],
  [
    'a52',
    '小企业会计准则（科目级数4-2-2）',
    'current',
    ['books-small-business'],
    '同制度按级次建账',
  ],
  [
    'a54',
    '民间非营利组织会计准则(2026)',
    'current',
    ['nonprofit-2026'],
    '未自动首次执行转换或法定报表',
  ],
  [
    'a35',
    '农民专业合作社会计制度(2023)',
    'current',
    ['farmer-cooperative-2023'],
    '实际成员等对象须建档；未自动权益备查',
  ],
  [
    'a53',
    '农村集体经济组织会计制度(2024)',
    'current',
    ['rural-collective-2024'],
    '实际对象及业务明细须配置',
  ],
  [
    'a49',
    '工会制度（2022）',
    'current',
    ['trade-union-2022'],
    '年度财政预算分类目录须按当年适用要求配置',
  ],
  [
    'a50',
    '基层工会制度（2022）',
    'current',
    ['grassroots-trade-union-2022'],
    '基层主要科目表；按实际业务增设适用科目',
  ],
  [
    'a07',
    '建筑施工企业会计准则',
    'current',
    ['construction-cas-revenue-2017', 'construction-small-business-2013'],
    '现行企业/小企业方案；旧2001施工基表未恢复',
  ],
  [
    'a12',
    '基建企业会计准则',
    'current',
    ['enterprise-infrastructure-cas'],
    '仅企业基建；历史1996/1998定义未注册',
  ],
  [
    'a13',
    '房地产开发企业会计准则',
    'current',
    ['real-estate-enterprise'],
    '现行企业准则及成本明细；历史独立制度未恢复',
  ],
  [
    'a11',
    '农村医疗会计准则',
    'current-replacement',
    ['resident-medical-insurance-2026'],
    '新农合旧制度已废止；提供2026居民医保基金替代，非原表恢复',
  ],
  [
    'a31',
    '中小学会计模版',
    'dual-system-required',
    [],
    '现行政府会计学校补充须财务/预算双体系；历史版本未恢复',
  ],
  [
    'a15',
    '国有建设单位会计准则',
    'dual-system-required',
    [],
    '现行政府基建须双体系；不能用企业基建冒充',
  ],
  [
    'a16',
    '投资担保行业',
    'current',
    ['financing-guarantee-cas22-2026', 'financing-guarantee-cas25-2026'],
    '须按合同明确选择适用准则；旧担保办法不恢复为现行',
  ],
  [
    'a17',
    '农村集体财务（一级科目3位）',
    'historical-missing',
    [],
    '旧原档案未恢复；2024制度不是旧表复制',
  ],
  [
    'a18',
    '农村村级财务（一级科目4位）',
    'historical-missing',
    [],
    '旧原档案未恢复；不能将2024编码填宽当作原表',
  ],
  [
    'a25',
    '医院会计准则',
    'dual-system-required',
    [],
    '现行公立医院政府双体系；医院自身账不同于医疗保险基金',
  ],
  [
    'a26',
    '基层医疗机构会计准则',
    'dual-system-required',
    [],
    '现行公立基层医疗政府双体系；非新农合基金账',
  ],
  ['a29', '财政总预算会计准则', 'dual-system-required', [], '现行财政总会计须财务/预算双体系'],
  [
    'a32',
    '小额贷款企业模版',
    'current',
    ['microloan-enterprise-cas22-2026'],
    '仅当前企业准则摊余成本贷款方案；不自动判断金融资产分类',
  ],
  [
    'a33',
    '典当行模版',
    'current',
    ['pawn-enterprise-cas-2021'],
    '现行企业准则行业方案；旧原档案未逐字恢复',
  ],
  ['a23', '出纳模版', 'source-required', [], '须原静态科目表及适用范围；不凭名称编造独立制度'],
  [
    'a46',
    '党费管理模板',
    'reference-only',
    ['party-dues-jining-port-2021'],
    '仅济宁港航地方deprecated参考，禁止作为全国党费制度建账',
  ],
  ['a24', '广东残联会计模版', 'source-required', [], '须地方原始适用文件及完整科目表'],
  [
    'a42',
    '民办幼儿园模版(2015)',
    'source-required',
    [],
    '须2015原始科目及明细；不以通用民非表宣称恢复',
  ],
  [
    'a43',
    '学校食堂会计制度模板',
    'regional-only',
    ['school-canteen-anhui-2021'],
    '仅安徽批准营养改善计划中小学校食堂，其他地区来源未齐',
  ],
  [
    'a45',
    '个体工商户模版',
    'current',
    ['individual-business-1997'],
    '复式账科目及明细；不按旧税率自动计税',
  ],
  [
    'a51',
    '幼儿园食堂会计制度模板',
    'source-required',
    [],
    '安徽中小学食堂办法不覆盖幼儿园，须幼儿园原始适用文件',
  ],
  [
    'a10',
    '事业单位会计准则(2019年停用)',
    'historical-missing',
    [],
    '历史科目未恢复；现行替代需政府双体系',
  ],
  [
    'a30',
    '行政单位会计准则(2019年停用)',
    'historical-missing',
    [],
    '历史科目未恢复；现行替代需政府双体系',
  ],
  ['a19', '学校会计准则(2013年停用)', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  ['a03', '企业会计准则(2007年停用)', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  ['a04', '小企业会计准则(2013年停用)', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  [
    'a08',
    '旧建筑施工企业会计准则',
    'historical-missing',
    [],
    '缺完整2001基础制度；已有补充不能替代基表',
  ],
  ['a09', '行政单位会计准则(2014年停用)', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  ['a14', '旧房地产开发企业会计准则', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  ['a27', '小企业会计准则(2006年停用)', 'historical-missing', [], '缺完整历史基表及有效期定义'],
  ['a20', '工会制度(2022年停用)', 'historical-missing', [], '2022工会不是旧版还原'],
  ['a22', '基层工会制度(2022年停用)', 'historical-missing', [], '2022基层表不是旧版还原'],
  ['a28', '农民专业合作社会计准则(2023年停用)', 'historical-missing', [], '2023农合不是旧版还原'],
  [
    'a06',
    '民间非营利组织会计准则(2026年停用)',
    'historical-missing',
    [],
    '2026民非不是2004旧版还原',
  ],
  ['a21', '旧基层工会制度', 'historical-missing', [], '缺完整历史基表及有效期定义'],
];

export const legacyTemplateCatalog: readonly LegacyTemplateEntry[] = rows.map(
  ([file, name, coverage, templateIds, remaining], index) => ({
    file: `${file}.acd`,
    order: index + 1,
    name,
    coverage,
    templateIds,
    remaining,
  }),
);
