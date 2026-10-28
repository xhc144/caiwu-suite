import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mapTemplateScheme, parseCodeScheme, parseTemplate, templateProblems } from '@caiwu/core';
import { createTestBook, voucherInputFromSpec } from '@caiwu/testkit';
import unionRaw from '../templates/trade-union-2022.json' with { type: 'json' };
import grassrootsRaw from '../templates/grassroots-trade-union-2022.json' with { type: 'json' };
import ruralRaw from '../templates/rural-collective-2024.json' with { type: 'json' };

const union = parseTemplate(unionRaw);
const grassroots = parseTemplate(grassrootsRaw);
const rural = parseTemplate(ruralRaw);

// 独立抄录财政部《工会会计制度》PDF第28、64–70、73–74、79–88页的正式编号。
const statutoryDetails = {
  '301': '01库存物品 02投资 03在建工程 04固定资产 05无形资产 06长期待摊费用',
  '321': '01年初余额调整 02单位内部调剂 03本年收支结转 04累计结转',
  '322': '01年初余额调整 02单位内部调剂 03本年收支结转 04结转转入 05累计结余',
  '331': '01年初余额调整 02单位内部调剂 03本年收支结转 04累计结转',
  '332': '01年初余额调整 02归集上缴 03单位内部调剂 04结转转入 05累计结余',
  '403': '01一般性转移支付补助 02专项转移支付补助',
  '404': '01财政拨款收入 02非同级财政拨款收入',
  '503':
    '01劳动和技能竞赛活动支出 02建家活动支出 03职工创新活动支出 04职工书屋活动支出 05其他服务支出',
  '504':
    '01劳动关系协调支出 02劳动保护支出 03法律援助支出 04困难职工帮扶支出 05送温暖支出 06其他维权支出',
  '505': '01培训支出 02会议支出 03专项业务支出 04其他业务支出',
  '506': '01工资福利支出 02商品和服务支出 03对个人和家庭的补助支出 04其他行政支出',
  '507':
    '01房屋建筑物购建 02办公设备购置 03专用设备购置 04交通工具购置 05大型修缮 06信息网络购建 07其他资本性支出',
  '508': '01一般性转移支付补助 02专项转移支付补助',
};
const secondLevel = (template: typeof union, parent: string) =>
  template.accounts
    .filter((a) => a.code.startsWith(parent) && a.code.length === parent.length + 2)
    .map((a) => `${a.code.slice(parent.length)}${a.name}`)
    .join(' ');

for (const [parent, expected] of Object.entries(statutoryDetails)) {
  it(`w_xt_kgzb_a2：县级以上工会${parent}保留全部原文编号和明细名称`, () => {
    expect(secondLevel(union, parent)).toBe(expected);
  });
}

it('w_xt_kgzb_a2：基层适用范围与支出正式明细独立', () => {
  expect(secondLevel(grassroots, '301')).toBe('01库存物品 04固定资产');
  expect(secondLevel(grassroots, '501')).toBe(
    '01职工教育支出 02文体活动支出 03宣传活动支出 04劳模职工疗休养支出 05会员活动支出 06其他活动支出',
  );
  for (const code of ['321', '322', '403', '503', '504', '505', '507'])
    expect(secondLevel(grassroots, code)).toBe(secondLevel(union, code));
  for (const code of ['331', '332', '404', '506', '508', '509', '521'])
    expect(grassroots.accounts.some((a) => a.code.startsWith(code))).toBe(false);
});

it('w_xt_kgzb_a2：县级支出区分资金来源和基本/项目支出，521保留原范围', () => {
  for (const code of ['502', '503', '504', '505', '506', '507', '508', '509', '510']) {
    const classCodes = ['509', '510'].includes(code)
      ? [code]
      : union.accounts
          .filter((a) => a.code.startsWith(code) && a.code.length === 5)
          .map((a) => a.code);
    for (const parent of classCodes) {
      expect(secondLevel(union, parent)).toBe('01财政拨款 02工会资金');
      for (const suffix of ['01', '02']) {
        expect(secondLevel(union, parent + suffix)).toBe('01基本支出 02项目支出');
        expect(
          union.accounts.find((a) => a.code === parent + suffix + '02')?.dimensions,
        ).toContainEqual({ type: 'project', required: true });
      }
    }
  }
  expect(union.accounts.filter((a) => a.code.startsWith('521'))).toHaveLength(1);
  for (const code of ['33101', '33102', '33103', '33104']) {
    expect(secondLevel(union, code)).toBe('01基本支出结转 02项目支出结转');
    expect(secondLevel(union, code + '01')).toBe('01人员经费 02公用经费');
  }
  expect(secondLevel(union, '40401')).toBe('01基本支出 02项目支出');
  expect(secondLevel(union, '4040101')).toBe('01人员经费 02公用经费');
});

it('w_xt_kgzb_a2：农村收益分配/经营收入/待处理按制度命名，成员不虚构为资本份额', () => {
  expect(secondLevel(rural, '322')).toBe('01各项分配 02未分配收益');
  expect(secondLevel(rural, '501')).toBe('01销售收入 02劳务收入 03出租收入 04发包收入');
  expect(secondLevel(rural, '181')).toBe('01待处理流动资产损溢 02待处理非流动资产损溢');
  expect(rural.accounts.find((a) => a.code === '32201')).toMatchObject({
    direction: 'debit',
    balanceNature: 'no-closing-balance',
  });
  for (const code of ['301', '311'])
    expect(rural.accounts.filter((a) => a.code.startsWith(code))).toHaveLength(1);
  for (const code of ['112', '113', '201', '211', '221'])
    expect(rural.accounts.find((a) => a.code === code)?.dimensions).toEqual([
      { type: 'partner', required: true },
    ]);
  for (const code of ['231', '241', '153', '171', '401', '50101', '502', '511', '514'])
    expect(rural.accounts.find((a) => a.code === code)?.dimensions).toEqual([
      { type: 'project', required: true },
    ]);
});

describe.each([
  { template: union, roots: 45, count: 375, scheme: '3-3-3-3' },
  { template: grassroots, roots: 24, count: 127, scheme: '3-3-3' },
  { template: rural, roots: 42, count: 90, scheme: '3-3-3' },
])('w_xt_kgzb_3：$template.id 规定明细真实加载', ({ template, roots, count, scheme }) => {
  it('一级数量、父链、备抵和来源保留，逐段映射后真实建账', async () => {
    expect(template.accounts.filter((a) => a.code.length === 3)).toHaveLength(roots);
    expect(template.accounts).toHaveLength(count);
    expect(templateProblems(template)).toEqual([]);
    const mapped = mapTemplateScheme(template, parseCodeScheme(scheme));
    expect(templateProblems(mapped)).toEqual([]);
    for (const a of template.accounts) {
      expect(a.sourceVersion).toBe('1.1.0');
      expect(a.needsReview).toBe(false);
      expect(a.source).toMatch(/\.pdf.*PDF第/);
      if (a.code.length > 3) {
        expect(a.source).toContain(a.code);
        expect(a.source).toContain(a.name);
      }
    }
    const book = await createTestBook({
      templates: [template],
      templateId: template.id,
      codeScheme: scheme,
      seed: false,
    });
    try {
      expect(await book.svc.dimensions.items()).toEqual([]);
      const rows = await book.svc.accounts.list();
      expect(rows).toHaveLength(count);
      for (const a of mapped.accounts) {
        const loaded = rows.find((r) => r.code === a.code)!;
        expect(loaded.name).toBe(a.name);
        expect(loaded.isLeaf).toBe(
          !mapped.accounts.some((r) => r.code.startsWith(a.code) && r.code.length > a.code.length),
        );
        if (a.code.length > 3)
          expect(loaded.parentId).toBe(rows.find((r) => r.code === a.code.slice(0, -3))?.id);
        if (a.isContra) expect(loaded.isContra).toBe(true);
      }
    } finally {
      await book.close();
    }
  });
});

it('w_xt_kgzb_a3：工会第四层在目标级次不足时拒绝，不截断', () => {
  expect(() => mapTemplateScheme(union, parseCodeScheme('3-3-3'))).toThrow(/无法映射/);
  const mapped = mapTemplateScheme(union, parseCodeScheme('3-3-3-3'));
  expect(mapped.accounts.find((a) => a.code === '331001001001')?.name).toBe('人员经费');
  expect(mapped.accounts.find((a) => a.code === '503001001002')?.name).toBe('项目支出');
});

it('w_xt_kgzb_3：工会项目支出缺项目拒绝，补齐后保存正确整数金额', async () => {
  const book = await createTestBook({ templates: [union], templateId: union.id, seed: false });
  try {
    const raw = await voucherInputFromSpec(book.svc, {
      date: '2026-01-05',
      lines: [
        { account: '503010102', debit: 12345 },
        { account: '102', credit: 12345 },
      ],
    });
    await expect(book.svc.vouchers.create(raw)).rejects.toMatchObject({
      data: { code: 'VOUCHER_INVALID' },
    });
    expect((await book.svc.vouchers.list({})).total).toBe(0);
    const project = await book.svc.dimensions.create({
      type: 'project',
      code: 'XM01',
      name: '合成测试项目',
    });
    const saved = await book.svc.vouchers.create({
      ...raw,
      lines: raw.lines.map((line, i) =>
        i === 0 ? { ...line, dimensions: { project: project.id } } : line,
      ),
    });
    expect(saved.debitTotal).toBe(12345);
    expect(saved.creditTotal).toBe(12345);
    expect(saved.lines[0]?.dimensions.project).toBe(project.id);
    expect(saved.lines[0]?.accountCode).toBe('503010102');
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_3：成员双向往来按对象保留，不以净额覆盖应收应付（整数分不变量）', async () => {
  const book = await createTestBook({ templates: [rural], templateId: rural.id, seed: false });
  try {
    await book.svc.dimensions.create({ type: 'partner', code: 'M01', name: '合成成员甲' });
    await book.svc.dimensions.create({ type: 'partner', code: 'M02', name: '合成成员乙' });
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(fc.integer({ min: 1, max: 999999 }), fc.integer({ min: 1, max: 999999 })),
        async ([receivable, payable]) => {
          const ids: number[] = [];
          try {
            for (const lines of [
              [
                { account: '113', debit: receivable, dims: { partner: 'M01' } },
                { account: '101', credit: receivable },
              ],
              [
                { account: '101', debit: payable },
                { account: '113', credit: payable, dims: { partner: 'M02' } },
              ],
            ]) {
              const saved = await book.svc.vouchers.create(
                await voucherInputFromSpec(book.svc, { date: '2026-01-05', lines }),
              );
              ids.push(saved.id);
              await book.svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
              await book.svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
            }
            const rows = await book.svc.ledger.balances({
              periodFrom: 202601,
              periodTo: 202601,
              accountCodes: ['113'],
              groupBy: ['partner'],
            });
            expect(rows.map((r) => r.closing).sort((a, b) => a - b)).toEqual([
              -payable,
              receivable,
            ]);
            expect(rows.reduce((sum, r) => sum + r.closing, 0)).toBe(receivable - payable);
          } finally {
            for (const id of ids) {
              await book.svc.vouchers.changeStatus({ ids: [id], to: 'audited' });
              await book.svc.vouchers.changeStatus({ ids: [id], to: 'pending' });
              await book.svc.vouchers.delete(id);
            }
          }
        },
      ),
      { numRuns: 8 },
    );
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_a2：工会在建工程列明七类及工程/其他投资下级，预付款同时核算单位与项目', () => {
  expect(secondLevel(union, '161')).toBe(
    '01建筑安装工程投资 02设备投资 03待摊投资 04其他投资 05待核销基建支出 06基建转出投资 07预付工程款',
  );
  expect(secondLevel(union, '16101')).toBe('01建筑工程 02安装工程');
  expect(secondLevel(union, '16104')).toBe(
    '01房屋购置 02基本畜禽支出 03林木支出 04办公生活用家具、器具购置 05可行性研究固定资产购置 06无形资产',
  );
  expect(union.accounts.find((a) => a.code === '16107')?.dimensions).toEqual([
    { type: 'project', required: true },
    { type: 'partner', required: true },
  ]);
});

it('w_xt_kgzb_3：对附属单位的项目支出同时要求单位与项目，少一项均不能正式保存', async () => {
  const book = await createTestBook({ templates: [union], templateId: union.id, seed: false });
  try {
    const project = await book.svc.dimensions.create({
      type: 'project',
      code: 'XM01',
      name: '合成项目',
    });
    const partner = await book.svc.dimensions.create({
      type: 'partner',
      code: 'DW01',
      name: '合成附属单位',
    });
    const raw = await voucherInputFromSpec(book.svc, {
      date: '2026-01-06',
      lines: [
        { account: '5090102', debit: 98765 },
        { account: '102', credit: 98765 },
      ],
    });
    for (const dimensions of [{ project: project.id }, { partner: partner.id }]) {
      const incomplete = {
        ...raw,
        lines: raw.lines.map((line, i) => (i === 0 ? { ...line, dimensions } : line)),
      };
      await expect(book.svc.vouchers.create(incomplete)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
    }
    expect((await book.svc.vouchers.list({})).total).toBe(0);
    const saved = await book.svc.vouchers.create({
      ...raw,
      lines: raw.lines.map((line, i) =>
        i === 0 ? { ...line, dimensions: { partner: partner.id, project: project.id } } : line,
      ),
    });
    expect(saved.lines[0]?.dimensions).toMatchObject({ partner: partner.id, project: project.id });
    expect(saved.debitTotal).toBe(98765);
    expect(saved.creditTotal).toBe(98765);
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_a2：农村工资、劳务、税费和管理费用常用明细来源及名称保持独立清单', () => {
  // 《农村集体经济组织会计制度》PDF第58–60、74–75、77页。
  // 以下为原文列示核算内容采用的应用明细，数字后缀不是法定统一编号。
  const details = {
    '212': '01工资 02奖金 03津贴 04补助 05社会保险费',
    '213': '01劳务费 02奖金 03津贴 04补助',
    '214':
      '01应交增值税 02应交个人所得税 03应交所得税 04应交消费税 05应交城市维护建设税 06应交资源税 07应交房产税 08应交城镇土地使用税 09应交车船税 10应交印花税 11应交教育费附加 12应交地方教育附加',
    '512':
      '01消费税 02城市维护建设税 03资源税 04房产税 05城镇土地使用税 06车船税 07印花税 08教育费附加 09地方教育附加',
    '513':
      '01工资 02办公费 03差旅费 04管理用固定资产修理费 05管理用固定资产折旧 06管理用无形资产摊销 07聘请中介机构费 08咨询费 09诉讼费 10村级组织和村务运转支出',
  };
  for (const [parent, expected] of Object.entries(details)) {
    expect(secondLevel(rural, parent)).toBe(expected);
    for (const a of rural.accounts.filter(
      (row) => row.code.startsWith(parent) && row.code !== parent,
    )) {
      expect(a.source).toContain('应用默认编码');
      if (parent === '212' || parent === '213')
        expect(a.dimensions).toEqual([{ type: 'person', required: true }]);
    }
  }
});
