import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestBook, seedVouchers, type TestBook } from '@caiwu/testkit';
import { chart } from './chart';
import { annual, seedFullYear, confirmFixture } from './fixture';
import {
  generateNonprofit,
  nonprofitCatalogue,
  verifyNonprofitBinding,
} from '../../templates/nonprofit/statutory.server';
import { classifyNetAssetEvents } from '../../templates/nonprofit/activity';
import { readNonprofitSources } from '../../templates/nonprofit/sources.server';
import type { Configuration } from '../../templates/nonprofit/model';

let book: TestBook, c: Configuration;
beforeEach(async () => {
  book = await createTestBook({ templateId: chart.id, templates: [chart], seed: false });
  c = await confirmFixture(book.svc, await seedFullYear(book.svc));
});
afterEach(async () => book?.close());
describe('w_bb_get / w_bb_proc / w_bb_saveas 民非实际来源反例', () => {
  it('非现金固定资产不能放入现金范围，即使现金表可自洽', async () => {
    c.cashScope.push({
      account: '1501',
      included: true,
      basis: '错误的合成范围',
      agency: false,
      restricted: false,
      equivalent: false,
    });
    await expect(generateNonprofit(book.svc, { ...annual, code: '403' }, c)).rejects.toThrow(
      /库存现金|现金等价物/,
    );
  });
  it('同一真实互转不能靠负借贷拆分虚增解除与设限', async () => {
    const s = await readNonprofitSources(book.svc, annual),
      release = c.events[0]!;
    release.amount = 100;
    for (const l of release.lines) {
      l.debit *= 2;
      l.credit *= 2;
    }
    const reverse = structuredClone(release);
    reverse.id = '虚增反向互转';
    reverse.kind = 'restriction';
    reverse.amount = 50;
    for (const l of reverse.lines) {
      l.debit *= -0.5;
      l.credit *= -0.5;
    }
    c.events.push(reverse);
    expect(() => classifyNetAssetEvents(s, c)).toThrow(/超过实际金额|方向/);
  });
  it('解除不能删除原时间限制，只保留较弱用途声明', async () => {
    c.resources[1]!.restriction!.time = { description: '2027年12月31日后使用' };
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /原时间|完整覆盖/,
    );
  });
  it('内部用途决议不是外部限定性依据', async () => {
    c.resources[1]!.restriction!.authority = 'internalDecision';
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /内部用途决议/,
    );
  });
  it('限定性资源年初不能任填虚增，须与真实3102年初相等', async () => {
    c.resources[1]!.openingBalance += 500;
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /资源年初分配与真实净资产/,
    );
  });
  it('逐笔确认不从末级映射自动补，前月缺行和净额零实际发生都拦截', async () => {
    c.recognitions = c.recognitions.filter((r) => r.line.period !== 202601);
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /逐笔确认不完整/,
    );
    await seedVouchers(book.svc, [
      {
        date: '2026-06-06',
        status: 'posted',
        lines: [
          { account: '1002', debit: 100 },
          { account: '4101', credit: 100 },
        ],
      },
      {
        date: '2026-06-07',
        status: 'posted',
        lines: [
          { account: '4101', debit: 100 },
          { account: '1002', credit: 100 },
        ],
      },
    ]);
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /逐笔确认不完整/,
    );
  });
  it('新增分录后原绑定生成回放和导出复核失效，原结果对象保留', async () => {
    const saved = await generateNonprofit(book.svc, annual, c),
      before = JSON.stringify(saved);
    await seedVouchers(book.svc, [
      {
        date: '2026-12-20',
        status: 'posted',
        lines: [
          { account: '1002', debit: 100 },
          { account: '4101', credit: 100 },
        ],
      },
    ]);
    await expect(verifyNonprofitBinding(book.svc, annual, c, saved)).rejects.toThrow(
      /逐笔确认不完整/,
    );
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('修改科目结构使来源绑定失效，不能沿用旧成功结果', async () => {
    const saved = await generateNonprofit(book.svc, annual, c);
    await book.svc.accounts.create(
      { code: '1992', name: '合成新增科目', categoryId: 'asset', direction: 'debit' },
      book.info.codeScheme,
    );
    await expect(verifyNonprofitBinding(book.svc, annual, c, saved)).rejects.toThrow(
      /科目或来源配置已变化/,
    );
  });
  it('期间、报告类别及已保存金额均绑定，改码或改金额不能洗白', async () => {
    const saved = await generateNonprofit(book.svc, annual, c);
    await expect(
      verifyNonprofitBinding(book.svc, { ...annual, code: '402' }, c, saved),
    ).rejects.toThrow(/来源配置已变化/);
    saved.statement.rows.find((r) => r.id === 'cash')!.values[0] = 999;
    await expect(verifyNonprofitBinding(book.svc, annual, c, saved)).rejects.toThrow(
      /来源配置已变化/,
    );
  });
  it('缺少资源取得关联、借贷分配超额或方向相反均拦截', async () => {
    c.recognitions[0]!.allocations[0]!.acquisitionReference = '其他批次';
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /取得或使用关联/,
    );
  });
  it('期末到期分类不能回填年初，金额或期限变化均要求重新确认', async () => {
    const fact = c.balanceFacts.find((f) => f.at === '2026-01-01' && f.key.startsWith('1402:'))!;
    fact.allocations[1]!.row = 'currentInvestment';
    await expect(generateNonprofit(book.svc, annual, c)).rejects.toThrow(/到期分类/);
  });
  it('月度不能冒充正式年度现金流量表；业务活动表和资产负债表支持真实中期', async () => {
    await expect(
      generateNonprofit(book.svc, { ...annual, code: '403', kind: 'month', from: 202612 }, c),
    ).rejects.toThrow(/现金流量表为年度报告/);
  });
  it('跨账套、跨年配置不被重新绑定，2026比较豁免不豁免401年初', async () => {
    c.bookId = '其他账套';
    await expect(generateNonprofit(book.svc, annual, c)).rejects.toThrow(/其他账套或年度/);
  });
  it('受托现金已从货币资金移列，与受托负债核对差额并定位', async () => {
    const f = c.balanceFacts.find((f) => f.at === '2026-12-31' && f.key.startsWith('1009:'))!;
    f.allocations[0]!.row = 'cash';
    f.allocations[0]!.agency = false;
    await expect(generateNonprofit(book.svc, annual, c)).rejects.toThrow(
      /受托代理资产.*期末余额.*差额/,
    );
  });
  it('真实制度决定目录适配，产品形态民非不能把企业账套认作民非制度', () => {
    expect(
      nonprofitCatalogue.applicable({
        ...book.info,
        regime: 'enterprise',
        templateId: 'demo-enterprise',
        product: 'minfei',
      }),
    ).toBe(false);
    expect(nonprofitCatalogue.applicable({ ...book.info, product: 'qingsong' })).toBe(true);
  });
  it('3201错结转到另一类净资产在402生成时拦截', async () => {
    c.events.find((e) => e.kind === 'priorAdjustment')!.resourceId = 'R';
    await expect(generateNonprofit(book.svc, { ...annual, code: '402' }, c)).rejects.toThrow(
      /以前年度调整结转/,
    );
  });
});

it('w_bb_proc 真实未过账数量随快照保存，只按已过账取数', async () => {
  await seedVouchers(book.svc, [
    {
      date: '2026-12-20',
      status: 'pending',
      lines: [
        { account: '1002', debit: 999 },
        { account: '4101', credit: 999 },
      ],
    },
  ]);
  const { statement } = await generateNonprofit(book.svc, annual, c);
  expect(statement.unpostedCount).toBe(1);
  expect(statement.rows.find((r) => r.id === 'cash')!.values).toEqual([300000, 326480]);
});
it('w_bb_get 官方科目不能改列为其他财务项目，即使总表可倒挤自洽', async () => {
  c.mappings.push({ account: '1201', row: 'otherExpense', basis: '错误的合成重分类' });
  await expect(generateNonprofit(book.svc, annual, c)).rejects.toThrow(/已有官方对应项目/);
});

it('w_bb_proc 普通库存现金不能无依据排除而伪造自洽现金首尾', async () => {
  c.cashScope.find((a) => a.account === '1001')!.included = false;
  await expect(generateNonprofit(book.svc, { ...annual, code: '403' }, c)).rejects.toThrow(
    /未纳入现金.*明确受限或受托/,
  );
});
it('w_bb_proc 同一银行科目混合普通与受托资金，逐笔与两时点分配分别取数且不重计', async () => {
  await book.svc.opening.upsert({
    year: 2026,
    accountId: (await book.svc.accounts.require('2601')).id,
    balance: -63000,
  });
  await book.svc.opening.upsert({
    year: 2026,
    accountId: (await book.svc.accounts.require('3101')).id,
    balance: -250000,
  });
  c.resources[0]!.openingBalance = 250000;
  const policy = c.cashScope.find((a) => a.account === '1002')!;
  policy.partitioned = true;
  policy.agency = true;
  await seedVouchers(book.svc, [
    {
      date: '2026-12-20',
      status: 'posted',
      summary: '合成普通及受托合并收款',
      lines: [
        { account: '1002', debit: 1000 },
        { account: '4101', credit: 600 },
        { account: '2601', credit: 400 },
      ],
    },
  ]);
  const s = await readNonprofitSources(book.svc, { ...annual, code: '403' }),
    line = s.entries.find((e) => e.date === '2026-12-20' && e.accountCode === '1002')!;
  c.cashConfirmations.push({
    line: {
      voucherId: line.voucherId,
      lineId: line.lineId,
      revision: line.revision,
      period: line.period,
      account: line.accountCode,
      debit: line.debit,
      credit: line.credit,
    },
    allocations: [
      { row: 'donations', amount: 600, sourceReference: '合成普通捐赠部分', nature: 'ordinary' },
      {
        row: 'excluded',
        amount: 400,
        exclusionReason: 'agency',
        sourceReference: '合成委托代发部分',
        nature: 'ordinary',
      },
    ],
  });
  for (const f of c.balanceFacts.filter((f) => f.key.startsWith('1002:'))) {
    const closing = f.at === '2026-12-31';
    f.balance = closing ? 227480 : 200000;
    f.allocations = [
      {
        row: 'cash',
        amount: closing ? 177080 : 150000,
        sourceReference: '合成银行普通部分',
        agency: false,
        cashIncluded: true,
      },
      {
        row: 'agencyAsset',
        amount: closing ? 50400 : 50000,
        sourceReference: '合成银行受托部分',
        agency: true,
        cashIncluded: false,
      },
    ];
  }
  const { statement } = await generateNonprofit(book.svc, { ...annual, code: '403' }, c);
  expect(statement.cashOpening).toBe(250000);
  expect(statement.cashClosing).toBe(277080);
  expect(statement.rows.find((r) => r.id === 'donations')!.values[0]).toBe(12600);
  expect(statement.rows.find((r) => r.id === 'cashNet')!.values[0]).toBe(27080);
  const missing = structuredClone(c);
  delete missing.balanceFacts.find((f) => f.at === '2026-01-01' && f.key.startsWith('1002:'))!
    .allocations[0]!.cashIncluded;
  await expect(generateNonprofit(book.svc, { ...annual, code: '403' }, missing)).rejects.toThrow(
    /现金范围分配不完整/,
  );
});
