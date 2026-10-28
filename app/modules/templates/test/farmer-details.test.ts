import { describe, expect, it } from 'vitest';
import { mapTemplateScheme, parseCodeScheme, parseTemplate, templateProblems } from '@caiwu/core';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import farmer from '../templates/farmer-cooperative-2023.json' with { type: 'json' };
import { integrationModules } from './template-fixtures';

const template = parseTemplate(farmer);

// 独立抄录财会〔2021〕37号附件的科目说明；数字后缀是本应用公开的默认编码。
// PDF物理页：25、33–55、57、59–62、67–69、71–78；不从被测JSON生成名称表。
const details: Record<string, string[]> = {
  '109': [
    '外埠存款',
    '银行汇票存款',
    '银行本票存款',
    '信用卡存款',
    '信用证保证金存款',
    '第三方支付平台账户余额',
  ],
  '131': ['联合社投资', '其他单位投资'],
  '141': ['扶贫项目资产', '非扶贫项目资产'],
  '142': ['扶贫项目资产', '非扶贫项目资产'],
  '143': ['扶贫项目资产', '非扶贫项目资产'],
  '144': ['扶贫项目资产', '非扶贫项目资产'],
  '151': ['扶贫项目资产', '非扶贫项目资产'],
  '152': ['扶贫项目资产', '非扶贫项目资产'],
  '153': ['扶贫项目资产', '非扶贫项目资产'],
  '154': ['扶贫项目资产', '非扶贫项目资产'],
  '161': ['扶贫项目资产', '非扶贫项目资产'],
  '162': ['扶贫项目资产', '非扶贫项目资产'],
  '181': ['待处理流动资产损溢', '待处理非流动资产损溢'],
  '212': ['工资', '奖金', '津贴', '补助', '社会保险费'],
  '213': ['劳务费', '奖金', '津贴', '补助'],
  '214': [
    '应交增值税',
    '应交企业所得税',
    '应交消费税',
    '应交城市维护建设税',
    '应交资源税',
    '应交房产税',
    '应交土地使用税',
    '应交车船使用税',
    '应交印花税',
    '应交教育费附加',
    '应交地方教育费附加',
    '应交个人所得税',
  ],
  '311': ['国家财政直接补助', '他人捐赠'],
  '332': ['各项分配', '未分配盈余'],
  '33201': ['提取盈余公积', '盈余返还', '剩余盈余分配'],
  '401': ['生产费用', '服务成本'],
  '502': ['资产盘盈收益', '无法支付的应付款项', '其他来源收入'],
  '522': [
    '消费税',
    '城市维护建设税',
    '资源税',
    '房产税',
    '土地使用税',
    '车船使用税',
    '印花税',
    '教育费附加',
    '地方教育费附加',
  ],
  '523': ['管理人员工资', '办公费', '差旅费', '业务招待费', '管理用固定资产折旧', '无形资产摊销'],
  '524': ['利息费用', '利息收入', '银行相关手续费'],
  '529': [
    '生物资产死亡毁损损失',
    '固定资产及产品物资盘亏损失',
    '防灾抢险支出',
    '安全生产支出',
    '环境保护支出',
    '罚款支出',
    '捐赠支出',
    '无法收回应收款项损失',
  ],
};

it('w_xt_kgzb_a2：农合保留48项法定一级与2项表注增设项，明细来源区分原文与默认编码', () => {
  expect(template.accounts.filter((a) => a.code.length === 3)).toHaveLength(50);
  expect(template.accounts.filter((a) => a.code.length > 3)).toHaveLength(89);
  expect(template.accounts.every((a) => a.needsReview === false)).toBe(true);
  expect(template.description).toContain('2023年1月1日');
  expect(template.description).toContain('明细编码');
  expect(template.description).toContain('不自动修改已有账套');
  for (const code of ['109', '122']) {
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      direction: 'debit',
      needsReview: false,
    });
    expect(template.accounts.find((a) => a.code === code)?.source).toContain('PDF第25页表下注');
  }
  for (const [parent, names] of Object.entries(details)) {
    const rows = template.accounts.filter(
      (a) => a.code.startsWith(parent) && a.code.length === parent.length + 2,
    );
    expect(rows.map(({ code, name }) => ({ code, name }))).toEqual(
      names.map((name, i) => ({ code: `${parent}${String(i + 1).padStart(2, '0')}`, name })),
    );
    for (const row of rows) {
      expect(row.source).toContain('应用默认');
      expect(row.source).toContain(`${row.code} ${row.name}`);
      expect(row.source).toMatch(/PDF第\d+/);
      expect(row.sourceVersion).toBe('1.1.0');
    }
  }
});

it('w_xt_kgzb_3：农合成员借贷性质、备抵、分配用途与利息冲减方向分别保留', () => {
  expect(template.accounts.find((a) => a.code === '114')).toMatchObject({
    direction: 'debit',
    balanceNature: 'both',
  });
  for (const code of ['14301', '14302', '15201', '15202', '16201', '16202']) {
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      direction: 'credit',
      isContra: true,
      balanceNature: 'credit',
    });
  }
  expect(template.accounts.find((a) => a.code === '33202')).toMatchObject({
    name: '未分配盈余',
    direction: 'credit',
    balanceNature: 'both',
    closingRule: 'retained-earnings',
  });
  for (const code of ['3320101', '3320102', '3320103']) {
    expect(template.accounts.find((a) => a.code === code)).toMatchObject({
      direction: 'debit',
      balanceNature: 'no-closing-balance',
      closingRule: 'clearing',
    });
  }
  expect(template.accounts.find((a) => a.code === '52402')).toMatchObject({
    name: '利息收入',
    category: 'pnl',
    direction: 'credit',
  });
});

it('w_xt_kgzb_a3：3-3-3映射保留农合三级用途父链与明细辅助项', () => {
  const mapped = mapTemplateScheme(template, parseCodeScheme('3-3-3'));
  expect(templateProblems(mapped)).toEqual([]);
  expect(mapped.accounts.find((a) => a.code === '332001001')).toMatchObject({
    name: '提取盈余公积',
    direction: 'debit',
    sourceVersion: '1.1.0',
  });
  expect(mapped.accounts.find((a) => a.code === '332001')?.name).toBe('各项分配');
  expect(mapped.accounts.find((a) => a.code === '142001')).toMatchObject({
    name: '扶贫项目资产',
    dimensions: [{ type: 'department', required: true }],
  });
  expect(mapped.accounts).toHaveLength(139);
  expect(template.accounts.some((a) => a.code === '332001001')).toBe(false);
});

const partnerCodes = [
  '113',
  '114',
  '124',
  '125',
  '127',
  '128',
  '201',
  '211',
  '215',
  '221',
  '222',
  '231',
  '301',
];

describe('w_xt_kgzb_3：农合按成员、人员、项目和所属部门明细核算', () => {
  it('只给原文明示的对象要求配置辅助项，不预设真实成员或将部门当成资产种类', () => {
    expect(template.accounts.filter((a) => a.partner).map((a) => a.code)).toEqual(partnerCodes);
    for (const code of partnerCodes) {
      expect(template.accounts.find((a) => a.code === code)?.dimensions).toContainEqual({
        type: 'partner',
        required: true,
      });
    }
    expect(
      template.accounts
        .filter((a) => a.dimensions.some((d) => d.type === 'department'))
        .map((a) => a.code),
    ).toEqual(['14201', '14202', '14301', '14302']);
    for (const code of ['14201', '14202', '14301', '14302']) {
      expect(template.accounts.find((a) => a.code === code)?.source).toContain('PDF第42页');
      expect(template.accounts.find((a) => a.code === code)?.source).toContain('所属部门');
    }
    for (const code of [
      '124',
      '15301',
      '15302',
      '171',
      '235',
      '40101',
      '40102',
      '501',
      '511',
      '521',
    ]) {
      expect(template.accounts.find((a) => a.code === code)?.dimensions).toContainEqual({
        type: 'project',
        required: true,
      });
    }
    for (const code of ['21201', '21205', '21301', '21304']) {
      expect(template.accounts.find((a) => a.code === code)?.dimensions).toEqual([
        { type: 'person', required: true },
      ]);
    }
  });

  it('真实建账强制成员对象、拒绝汇总科目，正式过账可按成员核对借贷余额', async () => {
    const app = await createTestApp({
      modules: [...integrationModules],
      templateId: 'farmer-cooperative-2023',
      seed: false,
    });
    try {
      expect(await app.svc.dimensions.items()).toEqual([]);
      const member = await app.svc.dimensions.create({
        type: 'partner',
        code: 'M001',
        name: '合成测试成员',
      });
      const missing = await voucherInputFromSpec(app.svc, {
        date: '2026-01-05',
        lines: [
          { account: '114', debit: 100_00 },
          { account: '102', credit: 100_00 },
        ],
      });
      await expect(app.svc.vouchers.create(missing)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      expect((await app.svc.vouchers.list({})).total).toBe(0);
      const saved = await app.svc.vouchers.create({
        ...missing,
        lines: missing.lines.map((line, i) =>
          i === 0 ? { ...line, dimensions: { partner: member.id } } : line,
        ),
      });
      await app.svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
      await app.svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
      expect(
        await app.svc.ledger.balances({
          periodFrom: 202601,
          periodTo: 202601,
          accountCodes: ['114'],
          groupBy: ['partner'],
        }),
      ).toMatchObject([{ dimensions: { partner: member.id }, closing: 100_00 }]);
      const summary = await voucherInputFromSpec(app.svc, {
        date: '2026-01-05',
        lines: [
          { account: '33201', debit: 50_00 },
          { account: '102', credit: 50_00 },
        ],
      });
      await expect(app.svc.vouchers.create(summary)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      const leaf = await app.svc.accounts.require('3320101');
      const distribution = await app.svc.vouchers.create({
        ...summary,
        lines: summary.lines.map((line, i) => (i === 0 ? { ...line, accountId: leaf.id } : line)),
      });
      expect(distribution.debitTotal).toBe(50_00);
      expect(distribution.lines[0]?.accountId).toBe(leaf.id);
    } finally {
      await app.close();
    }
  });
});
